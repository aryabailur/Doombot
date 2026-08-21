"""Natural-language search over a repository's indexed history.

Three stages, matching the feature spec:

  1. Query understanding -- the LLM translates a plain-English question into a
     semantic core plus metadata filters. It does not answer the question.
  2. Filtered vector search -- the semantic core is embedded and used to query
     Chroma with those filters applied.
  3. Ranking -- results are re-ordered by similarity, recency, engagement, and
     whatever the triage agent already concluded about each issue.

Nothing here generates a result. Every field on every hit comes from the vector
store or SQLite; the model is used only to read the question. That distinction is
the whole point -- a search that invents issues is worse than no search.

**The filters are not all pushed into the query, and the spec's claim that they
are is only half true.** Chroma applies a `where` clause before choosing the k
nearest, which is what makes `state` or `comments` filtering correct rather than
decorative. But its range operators require numbers, and issues are indexed with
`created_at` as an ISO *string*:

    ValueError: Expected operand value to be an int or a float for operator
    $gte, got 2025-01-01 in query

So date windows cannot be expressed in the query against an index built before
this feature existed. `index_issues` now also writes `created_ts` (epoch
seconds), which *can* be filtered in-query; until a repository is re-indexed the
date window falls back to a post-filter over an over-fetched candidate set. The
distinction matters and is reported per search in `SearchStats.filter_mode`, so
nobody has to guess whether a date filter was exact or best-effort.
"""

from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

# How many candidates to pull before post-filtering and ranking. Over-fetching
# is what keeps a post-filtered date window from returning almost nothing: the
# nearest neighbours to "slow performance" are mostly outside any given quarter,
# so filtering a bare top-20 would usually leave single digits.
OVERFETCH = 6
MAX_OVERFETCH = 200

# Ranking weights. Similarity dominates on purpose -- the other three are
# tie-breakers among results that already mean roughly the same thing, not
# independent claims to relevance.
W_SIMILARITY = 0.70
W_RECENCY = 0.10
W_ENGAGEMENT = 0.10
W_AGENT = 0.10

SORTS = ("relevance", "recency", "engagement")

# Floor below which a hit is not a result, just the k-th nearest vector.
#
# Deliberately far below the 0.65 duplicate threshold. Those thresholds compare
# a whole issue against a whole issue; this compares an expanded query phrase
# against a title plus body, and real matches land much lower -- measured on
# expressjs/express, the correct top hit for "performance complaints" scores
# 0.31 and useful hits continue down to 0.16. A 0.65 floor would return nothing
# on every query.
#
# What this does remove is padding: on a five-issue index, k=20 otherwise
# returns the entire repository sorted, so an issue about a dark-mode toggle
# appears under a performance query at "0% match". A result the reader can see
# is unrelated costs more trust than an empty list does.
MIN_SIMILARITY = 0.05


class SearchIntent(dict):
    """The parsed question. A dict subclass so it serialises without ceremony."""


def _empty_intent(query: str) -> SearchIntent:
    """The no-filters reading of a query: search for exactly what was typed.

    Every failure path lands here rather than raising. A search that quietly
    ignores "from last month" still returns real, relevant issues; a search that
    500s because the model was rate-limited returns nothing at all.
    """
    return SearchIntent(
        semantic_query=query.strip(),
        state=None,
        created_after=None,
        created_before=None,
        labels=[],
        author=None,
        unanswered=False,
        min_reactions=None,
        sort="relevance",
        understood=False,
        note="",
    )


_PROMPT = """You translate a maintainer's question about a GitHub repository \
into search parameters. You do NOT answer the question.

Today is {today}. Resolve every relative date against it.

Return ONLY a JSON object with these keys:

  semantic_query   string. The meaning to search for, expanded into the words
                   contributors would actually use. Do not include filter
                   words like dates, "open", "closed", or "unanswered" here.
  state            "open", "closed", or null.
  created_after    "YYYY-MM-DD" or null.
  created_before   "YYYY-MM-DD" or null.
  labels           array of label names the issue must carry; [] if none.
  author           string GitHub username, or null.
  unanswered       true only if the user asked for issues nobody replied to.
  min_reactions    integer, or null.
  sort             "relevance", "recency", or "engagement".

Rules:
- semantic_query must never be empty. If the question is entirely filters,
  restate its subject in your own words.
- Expand vocabulary. "performance complaints" -> "slow performance latency
  timeout hangs high memory usage takes a long time".
- Do not invent filters the question does not ask for.

Question: {query}

JSON:"""


def _get_llm():
    """Lazily construct the Groq chat model, as elsewhere in the project.

    Lazy so importing this module for a test that never touches the LLM does
    not require GROQ_API_KEY.
    """
    from langchain_groq import ChatGroq

    return ChatGroq(model=os.getenv("GROQ_MODEL", "openai/gpt-oss-120b"))


def parse_intent(query: str, *, today: str | None = None) -> SearchIntent:
    """Stage 1. Translate a natural-language query into search parameters.

    Degrades to `_empty_intent` on any failure -- no key, rate limit, malformed
    JSON, model outage. `understood=False` on the result tells the caller (and
    the UI) that only the literal text was searched, so the absence of an
    expected filter is visible rather than silent.
    """
    text = (query or "").strip()
    if not text:
        return _empty_intent("")

    stamp = today or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    try:
        response = _get_llm().invoke(_PROMPT.format(today=stamp, query=text))
        raw = getattr(response, "content", "") or ""
    except Exception:
        logger.warning("query understanding unavailable; searching literally", exc_info=True)
        intent = _empty_intent(text)
        intent["note"] = "Query understanding unavailable — searched the text as typed."
        return intent

    return coerce_intent(raw, fallback=text)


def coerce_intent(raw: str, *, fallback: str) -> SearchIntent:
    """Validate a model response into an intent, keeping only usable fields.

    Split out from `parse_intent` so the parsing rules can be tested without a
    network call -- the model's output shape is the part that actually breaks.
    """
    intent = _empty_intent(fallback)

    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if not match:
        intent["note"] = "Could not read the query plan — searched the text as typed."
        return intent
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError:
        intent["note"] = "Could not read the query plan — searched the text as typed."
        return intent
    if not isinstance(data, dict):
        return intent

    semantic = str(data.get("semantic_query") or "").strip()
    # A model that returns only filters would otherwise search for nothing and
    # return the arbitrary k nearest to an empty string.
    intent["semantic_query"] = semantic or fallback

    state = str(data.get("state") or "").strip().lower()
    intent["state"] = state if state in ("open", "closed") else None

    for key in ("created_after", "created_before"):
        value = str(data.get(key) or "").strip()
        intent[key] = value if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value) else None

    labels = data.get("labels")
    if isinstance(labels, list):
        intent["labels"] = [str(x).strip().lower() for x in labels if str(x).strip()][:6]

    author = str(data.get("author") or "").strip()
    intent["author"] = author or None

    intent["unanswered"] = bool(data.get("unanswered"))

    try:
        floor = int(data.get("min_reactions"))
        intent["min_reactions"] = floor if floor > 0 else None
    except (TypeError, ValueError):
        intent["min_reactions"] = None

    sort = str(data.get("sort") or "").strip().lower()
    intent["sort"] = sort if sort in SORTS else "relevance"

    intent["understood"] = True
    return intent


def build_where(intent: dict, *, dates_in_query: bool) -> dict | None:
    """Stage 2a. The Chroma `where` clause for the filters Chroma can apply.

    Applied before the k nearest are chosen, so these are real constraints and
    not cosmetic. `dates_in_query` is set only when the collection carries the
    numeric `created_ts` field; otherwise dates are handled by `post_filter`.

    Returns None when there is nothing to constrain -- Chroma treats an empty
    dict as a filter that matches nothing on some versions, which silently
    empties every result.
    """
    clauses: list[dict] = []

    if intent.get("state"):
        clauses.append({"state": {"$eq": intent["state"]}})
    if intent.get("unanswered"):
        # The closest honest proxy: nobody commented at all. Distinguishing a
        # maintainer's reply from any reply needs a collaborators list the index
        # does not carry, so this is deliberately the weaker, checkable claim.
        clauses.append({"comments": {"$eq": 0}})
    if intent.get("min_reactions"):
        clauses.append({"reactions": {"$gte": int(intent["min_reactions"])}})
    if intent.get("author"):
        clauses.append({"author": {"$eq": intent["author"]}})

    if dates_in_query:
        if intent.get("created_after"):
            clauses.append({"created_ts": {"$gte": _to_epoch(intent["created_after"])}})
        if intent.get("created_before"):
            clauses.append({"created_ts": {"$lte": _to_epoch(intent["created_before"])}})

    if not clauses:
        return None
    if len(clauses) == 1:
        return clauses[0]
    return {"$and": clauses}


def _to_epoch(day: str) -> int:
    try:
        return int(datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp())
    except ValueError:
        return 0


def _parse_created(value: str) -> datetime | None:
    """Parse a timestamp to an **aware** UTC datetime, or None.

    Always aware. Two shapes reach this function -- GitHub's
    "2026-08-21T02:14:07Z" from the index and the model's bare "2026-02-21"
    from a date filter -- and `fromisoformat` returns a naive datetime for the
    second. Comparing the two raises "can't compare offset-naive and
    offset-aware datetimes", which took out every dated query.
    """
    text = str(value or "").strip()
    if not text:
        return None

    parsed = None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        try:
            parsed = datetime.strptime(text[:10], "%Y-%m-%d")
        except ValueError:
            return None

    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def post_filter(hits: list[dict], intent: dict, *, dates_in_query: bool) -> list[dict]:
    """Stage 2b. The filters Chroma cannot express, applied to over-fetched hits.

    Two of them, both honest about their limits:

    - **Date window**, only when the collection predates `created_ts`. Handled
      here because Chroma rejects range operators on a string field.
    - **Labels**, always. Labels are stored comma-joined into one string, so
      "bug" has to match a member of that list rather than the whole value. An
      `$eq` would only match an issue whose *entire* label set is exactly "bug".
    """
    after = _parse_created(intent.get("created_after") or "")
    before = _parse_created(intent.get("created_before") or "")
    wanted = [label.lower() for label in intent.get("labels") or []]

    kept: list[dict] = []
    for hit in hits:
        if not dates_in_query and (after or before):
            created = _parse_created(hit.get("created_at") or "")
            if created is None:
                # An issue with no usable date cannot be shown to satisfy a date
                # filter, so it is dropped rather than assumed to qualify.
                continue
            if after and created < after:
                continue
            if before and created > before + timedelta(days=1):
                continue

        if wanted:
            have = {label.strip().lower() for label in hit.get("labels") or []}
            if not any(label in have for label in wanted):
                continue

        kept.append(hit)
    return kept


def _snippet(body: str, semantic_query: str, limit: int = 320) -> str:
    """The passage of the issue most related to the query.

    Word overlap, not a second embedding call: this runs per result, and the
    difference between a good snippet and a great one does not justify k more
    model round-trips on every keystroke. Falls back to the opening passage,
    which is what a reader would have seen anyway.
    """
    text = (body or "").strip()
    if not text:
        return ""

    terms = {w for w in re.findall(r"[a-z0-9']+", semantic_query.lower()) if len(w) > 2}
    passages = [p.strip() for p in re.split(r"\n\s*\n|(?<=[.!?])\s{1,}", text) if p.strip()]
    if not passages:
        return text[:limit]
    if not terms:
        return passages[0][:limit]

    best, best_score = passages[0], -1
    for passage in passages:
        words = set(re.findall(r"[a-z0-9']+", passage.lower()))
        score = len(terms & words)
        if score > best_score:
            best, best_score = passage, score
    return best[:limit]


def _agent_context(repo_name: str) -> dict[int, dict]:
    """What the triage agent already concluded, keyed by issue number.

    Read from SQLite, not recomputed. This is the column GitHub search cannot
    have: "the agent looked at this one and said duplicate, 87% confident".
    Never raises -- search must work on a repository the agent has never run on.
    """
    try:
        from memory import repo as store

        by_number: dict[int, dict] = {}
        for row in store.list_investigations():
            if row.get("repo_name") != repo_name or row.get("kind") != "issue":
                continue
            number = row.get("number")
            if number is None:
                continue
            previous = by_number.get(int(number))
            # Keep the newest investigation per issue: an issue re-triaged after
            # new information should be described by the latest verdict.
            if previous and str(previous.get("created_at") or "") > str(row.get("created_at") or ""):
                continue
            by_number[int(number)] = {
                "investigation_id": row.get("id"),
                "decision": row.get("decision"),
                "confidence": row.get("confidence"),
                "status": row.get("status"),
            }
        return by_number
    except Exception:
        logger.warning("agent context unavailable for %s", repo_name, exc_info=True)
        return {}


def _recency_score(created_at: str, now: datetime) -> float:
    created = _parse_created(created_at)
    if created is None:
        return 0.0
    age_days = max(0.0, (now - created).total_seconds() / 86400.0)
    # Half a year to decay to ~0.5; older issues are not irrelevant, just less
    # likely to be what someone asking a question today means.
    return 1.0 / (1.0 + age_days / 180.0)


def _engagement_score(comments: int, reactions: int) -> float:
    import math

    # Log, because the gap between 0 and 5 comments means far more than the gap
    # between 80 and 85, and a linear scale lets one viral thread dominate.
    return min(1.0, math.log1p(max(0, comments) + max(0, reactions) * 2) / math.log(60))


def rank(hits: list[dict], intent: dict, *, now: datetime | None = None) -> list[dict]:
    """Stage 3. Order the results, and show why each one ranked where it did.

    `relevance` blends the four signals. `recency` and `engagement` sort on that
    field directly -- someone who asked for "the newest" means it, and quietly
    re-mixing similarity back in would answer a question they did not ask.
    """
    moment = now or datetime.now(timezone.utc)
    sort = intent.get("sort") or "relevance"

    for hit in hits:
        similarity = float(hit.get("score") or 0.0)
        recency = _recency_score(hit.get("created_at") or "", moment)
        engagement = _engagement_score(hit.get("comments") or 0, hit.get("reactions") or 0)
        agent = hit.get("agent") or {}
        try:
            confidence = float(agent.get("confidence") or 0.0)
        except (TypeError, ValueError):
            confidence = 0.0

        hit["rank_score"] = round(
            W_SIMILARITY * similarity
            + W_RECENCY * recency
            + W_ENGAGEMENT * engagement
            + W_AGENT * confidence,
            4,
        )

    if sort == "recency":
        hits.sort(key=lambda h: _parse_created(h.get("created_at") or "") or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    elif sort == "engagement":
        hits.sort(key=lambda h: (h.get("comments") or 0) + 2 * (h.get("reactions") or 0), reverse=True)
    else:
        hits.sort(key=lambda h: h["rank_score"], reverse=True)
    return hits


def search(repo_name: str, query: str, k: int = 20) -> dict:
    """Run all three stages and return ranked, factual results.

    Never raises for an ordinary miss: an unindexed repository, an empty
    collection, or a query nothing matches all return an empty `results` list
    with the parsed intent attached, so the UI can say *why* nothing came back.
    """
    from rag.retriever import retrieve_filtered

    intent = parse_intent(query)
    if not intent["semantic_query"]:
        return {
            "repo_name": repo_name,
            "query": query,
            "intent": intent,
            "results": [],
            "stats": {"considered": 0, "returned": 0, "filter_mode": "none", "indexed": 0},
        }

    wants_dates = bool(intent.get("created_after") or intent.get("created_before"))
    dates_in_query = wants_dates and _collection_has_created_ts(repo_name)

    where = build_where(intent, dates_in_query=dates_in_query)
    # Only over-fetch when something will be dropped afterwards; otherwise the
    # query Chroma already answered exactly is the query we want.
    needs_overfetch = (wants_dates and not dates_in_query) or bool(intent.get("labels"))
    fetch = min(MAX_OVERFETCH, k * OVERFETCH) if needs_overfetch else k

    try:
        raw = retrieve_filtered(intent["semantic_query"], repo_name, kind="issues", k=fetch, where=where)
    except Exception:
        logger.warning("search failed for %s", repo_name, exc_info=True)
        raw = []

    agent_by_number = _agent_context(repo_name)

    hits: list[dict] = []
    for doc, score in raw:
        metadata = doc.metadata or {}
        content = doc.page_content or ""
        title, _, body = content.partition("\n\n")
        number = metadata.get("number")
        labels = [x for x in str(metadata.get("labels") or "").split(",") if x.strip()]
        hits.append(
            {
                "number": int(number) if number is not None else None,
                "title": title.strip() or f"Issue {number}",
                "state": str(metadata.get("state") or ""),
                "labels": labels,
                "author": str(metadata.get("author") or ""),
                "created_at": str(metadata.get("created_at") or ""),
                "comments": int(metadata.get("comments") or 0),
                "reactions": int(metadata.get("reactions") or 0),
                "score": round(float(score), 4),
                "snippet": _snippet(body, intent["semantic_query"]),
                "agent": agent_by_number.get(int(number)) if number is not None else None,
            }
        )

    considered = len(hits)
    hits = post_filter(hits, intent, dates_in_query=dates_in_query)
    below_floor = sum(1 for hit in hits if float(hit.get("score") or 0.0) < MIN_SIMILARITY)
    hits = [hit for hit in hits if float(hit.get("score") or 0.0) >= MIN_SIMILARITY]
    hits = rank(hits, intent)[:k]

    if not wants_dates:
        mode = "in_query"
    elif dates_in_query:
        mode = "in_query"
    else:
        mode = "post_filtered_dates"

    return {
        "repo_name": repo_name,
        "query": query,
        "intent": intent,
        "results": hits,
        "stats": {
            "considered": considered,
            "returned": len(hits),
            "filter_mode": mode,
            "indexed": _collection_size(repo_name),
            # Surfaced rather than silently dropped: "8 more were too weak to
            # show" is information, and hiding it would make a short list look
            # like a small index.
            "below_floor": below_floor,
        },
    }


def _collection_size(repo_name: str) -> int:
    try:
        from rag.embedder import get_collection

        collection = getattr(get_collection(repo_name, "issues"), "_collection", None)
        return int(collection.count()) if collection is not None else 0
    except Exception:
        return 0


def _collection_has_created_ts(repo_name: str) -> bool:
    """Whether this collection was indexed with the numeric date field.

    Checked rather than assumed: collections indexed before `created_ts` existed
    are the common case, and asking Chroma to range-filter a field that is not
    there returns nothing instead of erroring.
    """
    try:
        from rag.embedder import get_collection

        collection = getattr(get_collection(repo_name, "issues"), "_collection", None)
        if collection is None:
            return False
        sample = collection.get(limit=1, include=["metadatas"])
        rows = sample.get("metadatas") or []
        return bool(rows) and "created_ts" in (rows[0] or {})
    except Exception:
        return False
