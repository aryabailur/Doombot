from rag.embedder import get_collection


def retrieve(query, repo_name):
    """EXISTING — keep signature and behavior unchanged. Searches the
    `{repo}-code` collection via similarity_search(query, k=3). reviewer.py
    depends on doc.page_content directly, so the return type stays
    list[Document]."""
    vector_db = get_collection(repo_name, "code")
    results = vector_db.similarity_search(query, k=3)
    return results


def retrieve_with_scores(query: str, repo_name: str, kind: str = "issues", k: int = 5) -> list:
    """Like retrieve(), but returns (Document, relevance_score) pairs from
    the named collection ("code" or "issues").

    Returns TRUE COSINE SIMILARITY: 0-1, higher is better, matching the
    thresholds in rag/CLAUDE.md and agents/CLAUDE.md.

    CRITICAL — score direction. This calls `similarity_search_with_score`,
    which returns raw L2 **distance** (lower is better), and converts it to
    cosine below. That is deliberate and must not be "fixed" back to
    `similarity_search_with_relevance_scores`:

    - The relevance variant does NOT return cosine. It computes
      `1 - L2/sqrt(2)`, which compresses the scale and goes negative for
      distant pairs. Measured on a real duplicate pair: true cosine 0.692,
      relevance score 0.445 -- below the 0.65 "related" cut, so a genuine
      duplicate was dropped entirely.
    - Because all-MiniLM-L6-v2 emits L2-normalized vectors,
      ||a-b||^2 = 2(1 - cos) holds exactly, so cos = 1 - L2^2/2 is an exact
      recovery, not an approximation.

    The trap this docstring originally warned about -- returning a distance
    where a similarity is expected -- is still real. It is avoided here by
    converting, not by picking the other method.
    """
    vector_db = get_collection(repo_name, kind)

    # Return TRUE COSINE SIMILARITY, recovered from Chroma's L2 distance.
    #
    # Chroma defaults to an L2 collection and LangChain converts that to a
    # "relevance score" as `1 - L2/sqrt(2)`. That conversion is not cosine and
    # badly compresses the scale: a real duplicate pair measured cosine 0.692
    # but was reported as 0.445, and an unrelated pair came back NEGATIVE
    # (-0.35), which LangChain itself warns about.
    #
    # Every threshold in rag/CLAUDE.md and agents/CLAUDE.md (>0.85 duplicate,
    # 0.65-0.85 related) is specified as cosine, so using the raw relevance
    # score silently under-scores every match and drops genuine duplicates --
    # the exact failure the thresholds exist to catch.
    #
    # all-MiniLM-L6-v2 emits L2-normalized vectors, so for unit vectors
    # ||a-b||^2 = 2(1 - cos), giving cos = 1 - L2^2/2 exactly. Verified: this
    # recovers 0.692 from the same pair LangChain scored 0.445.
    results = vector_db.similarity_search_with_score(query, k=k)

    scored = []
    for doc, l2 in results:
        cosine = 1.0 - (l2 * l2) / 2.0
        scored.append((doc, max(0.0, min(1.0, cosine))))
    return scored


def find_duplicates(issue_text: str, repo_name: str, exclude_number=None) -> dict:
    """Find semantically similar past issues in `{repo}-issues`.

    Returns {"duplicates": [...], "related": [...]} where each item is
    {"number": int, "score": float, "title": str, "relation": "duplicate"|"related"}.

    Buckets: score > 0.85 -> duplicate; 0.65 <= score <= 0.85 -> related;
    below 0.65 is dropped entirely.

    CRITICAL: exclude_number MUST filter out that issue number from the
    results. The issue currently being triaged is itself already indexed
    in the `{repo}-issues` collection, so it will always come back as its
    own nearest neighbour with a score of ~1.0. Without this filter, every
    issue would be reported as a "duplicate" of itself, which makes the
    whole feature useless. Do not remove or weaken this check.
    """
    k = 5 + 5  # over-fetch so excluding self doesn't shrink the result set

    try:
        results = retrieve_with_scores(issue_text, repo_name, kind="issues", k=k)
    except Exception:
        # Collection doesn't exist yet / repo not indexed / empty index —
        # fail soft rather than crash the caller.
        return {"duplicates": [], "related": []}

    duplicates = []
    related = []

    for doc, score in results:
        number = doc.metadata.get("number")

        # Exclusion is mandatory — see docstring above.
        if exclude_number is not None and number == exclude_number:
            continue

        if score < 0.65:
            continue

        title = doc.metadata.get("title")
        if not title:
            title = (doc.page_content or "").split("\n", 1)[0].strip()

        item = {
            "number": number,
            "score": score,
            "title": title,
        }

        if score > 0.85:
            item["relation"] = "duplicate"
            duplicates.append(item)
        else:
            item["relation"] = "related"
            related.append(item)

    return {"duplicates": duplicates, "related": related}


def find_precedents(
    issue_text: str,
    repo_name: str,
    exclude_number=None,
    limit: int = 4,
) -> list[dict]:
    """Closed issues most like this one, with the labels a maintainer applied.

    F17, adaptive repository learning. Every closed issue is a decision a human
    already made: the labels they chose, on an issue they judged resolved. Those
    are the project's own conventions, and they are better grounding for
    classifying a new issue than the model's general priors.

    Filtered to `state == "closed"` **in the query**, not afterwards. Chroma's
    `filter` applies before the k nearest are chosen, so post-filtering a plain
    top-k would usually return nothing useful -- on an active repository the
    nearest neighbours are mostly open issues, and dropping them after the fact
    leaves an empty list while genuinely similar closed issues sat just outside
    k.

    Only issues at or above RELATED_THRESHOLD are returned, and only those that
    actually carry labels: an unlabelled closed issue teaches nothing about the
    project's taxonomy, which is the entire point of the retrieval. Returns
    newest-most-similar first, capped at `limit`.

    An empty list is a normal result -- a young repository has no precedent --
    and callers must degrade rather than invent examples.
    """
    # Imported from rag.graph so there is exactly one definition of "similar
    # enough" in the project. A second literal here is how two parts of the
    # same system start disagreeing about what a duplicate is.
    from rag.graph import RELATED_THRESHOLD

    # Over-fetch: some neighbours will be unlabelled or the issue itself, and
    # those are dropped below.
    raw = retrieve_with_scores(
        issue_text,
        repo_name,
        kind="issues",
        k=max(limit * 3, 12),
    )

    precedents: list[dict] = []
    for doc, score in raw:
        if score < RELATED_THRESHOLD:
            continue

        metadata = doc.metadata or {}
        if str(metadata.get("state", "")).lower() != "closed":
            continue

        number = metadata.get("number")
        if number is None or (exclude_number is not None and number == exclude_number):
            continue

        labels = [
            label.strip()
            for label in str(metadata.get("labels") or "").split(",")
            if label.strip()
        ]
        if not labels:
            continue

        first_line = (doc.page_content or "").splitlines()[:1]
        title = metadata.get("title") or (first_line[0] if first_line else "")
        precedents.append(
            {
                "number": number,
                "score": round(score, 3),
                "labels": labels,
                "title": title.strip()[:120],
            }
        )
        if len(precedents) >= limit:
            break

    return precedents
