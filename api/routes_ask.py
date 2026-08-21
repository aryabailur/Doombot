"""Ask RepoGuardian — a repository-aware, evidence-backed Q&A endpoint.

    POST /api/ask   -> AskResponse

Answers questions about why an issue/PR was triaged the way it was, using
only real data recorded for the investigation (or, absent an investigation,
real RAG retrieval over the repo's indexed issue corpus). Never invents a
citation, file path, confidence value, or precedent count — every number in
the response traces back to a real DB row, a real evidence item emitted by
the triage graph, or a real file path from the repo's GitHub tree.
"""
import logging
import re

from fastapi import APIRouter, HTTPException
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_groq import ChatGroq

from api.routes_repos import _best_effort_file_match, _get_repo_files_fast
from api.schemas import AskCitation, AskRequest, AskResponse, AskVisual
from memory import repo as db
from rag.retriever import retrieve_with_scores

logger = logging.getLogger(__name__)

router = APIRouter()

llm = ChatGroq(model="openai/gpt-oss-120b")

# Below this relevance score, a general (non-investigation) RAG hit isn't
# meaningful enough to ground an answer on — honest "I don't know" instead.
# Tuned empirically against this project's MiniLM embeddings + Chroma's
# similarity_search_with_relevance_scores: a genuinely on-topic query (e.g.
# "login authentication broken") scores 0.5-0.7 against a matching issue,
# while unrelated queries ("hi") score well under 0.1 even against their
# nearest neighbor in a small collection. 0.15 clears real topical matches
# while still rejecting noise.
MIN_GENERAL_RETRIEVAL_SCORE = 0.15

# Decision actions the triage decider actually produces (agents/triage/decider.py).
DECISION_ACTIONS = ("close_as_duplicate", "escalate", "auto_comment", "hold")

_ISSUE_NUMBER_RE = re.compile(r"#(\d+)")


def _insufficient_evidence_response(answer: str) -> AskResponse:
    return AskResponse(
        answer=answer,
        visuals=[],
        citations=[],
        confidence=None,
        insufficient_evidence=True,
        suggested_actions=[],
    )


def _clamp01(value: float | None) -> float:
    if value is None:
        return 0.0
    return max(0.0, min(1.0, value))


def _resolve_investigation(payload: AskRequest) -> dict | None:
    """Resolve the investigation to ground the answer in, if any.

    Priority: explicit investigation_id (raises 404 if given but not found)
    -> a "#123"-shaped issue number parsed from the question, matched
    against the most recent investigation for (repo_name, number).
    """
    if payload.investigation_id:
        inv = db.get_investigation(payload.investigation_id)
        if inv is None:
            raise HTTPException(status_code=404, detail="investigation not found")
        return inv

    match = _ISSUE_NUMBER_RE.search(payload.question)
    if not match:
        return None
    number = int(match.group(1))

    candidates = [
        inv
        for inv in db.list_investigations()
        if inv["repo_name"] == payload.repo_name and inv["number"] == number
    ]
    if not candidates:
        return None
    # list_investigations() is already newest-first.
    return candidates[0]


def _flatten_evidence(steps: list[dict]) -> list[dict]:
    flattened: list[dict] = []
    for step in steps:
        for ev in step.get("evidence", []) or []:
            if isinstance(ev, dict):
                flattened.append(ev)
    return flattened


def _build_citations(evidence: list[dict], own_number: int | None) -> list[AskCitation]:
    """One AskCitation per real evidence item. Skips the self-citation bug:
    a `duplicate`-type evidence entry whose ref equals the investigation's
    own issue number (find_duplicates is supposed to already exclude this,
    but citations are user-facing, so we defend here too)."""
    citations: list[AskCitation] = []
    own_number_str = str(own_number) if own_number is not None else None
    for ev in evidence:
        ev_type = ev.get("type", "")
        ref = str(ev.get("ref", ""))
        if ev_type == "duplicate" and own_number_str is not None and ref == own_number_str:
            continue
        number: int | None = None
        if ev_type == "duplicate" and ref.isdigit():
            number = int(ref)
        citations.append(
            AskCitation(
                type=ev_type,
                ref=ref,
                score=ev.get("score"),
                snippet=ev.get("snippet", "") or "",
                number=number,
            )
        )
    return citations


def _build_evidence_bar(evidence: list[dict]) -> AskVisual | None:
    items = []
    for ev in evidence:
        ev_type = ev.get("type")
        if ev_type not in ("security", "duplicate", "impact"):
            continue
        score = ev.get("score")
        if score is None:
            continue
        items.append({"label": ev.get("ref", ev_type), "value": _clamp01(score), "type": ev_type})
    if not items:
        return None
    return AskVisual(kind="evidence_bar", data={"items": items})


def _build_similar_incidents(evidence: list[dict]) -> AskVisual | None:
    items = []
    for ev in evidence:
        if ev.get("type") != "duplicate":
            continue
        ref = ev.get("ref", "")
        if not str(ref).isdigit():
            continue
        items.append(
            {
                "number": int(ref),
                "title": ev.get("snippet", "") or "",
                "score": _clamp01(ev.get("score")),
            }
        )
    if not items:
        return None
    return AskVisual(kind="similar_incidents", data={"items": items})


def _build_architecture_impact(evidence: list[dict], repo_name: str) -> AskVisual:
    """Best-effort match of evidence refs against real file paths from the
    repo's GitHub tree, reusing the same matcher the /graph endpoint uses.
    Zero matches is reported honestly, never a fabricated path."""
    try:
        file_paths = _get_repo_files_fast(repo_name)
    except Exception:
        logger.exception("architecture_impact: file listing failed for %s", repo_name)
        file_paths = []

    file_ids_by_path = {path: path for path in file_paths}
    matched: list[str] = []
    seen: set[str] = set()
    for ev in evidence:
        ref = ev.get("ref")
        if not ref:
            continue
        match = _best_effort_file_match(str(ref), file_ids_by_path)
        if match and match not in seen:
            seen.add(match)
            matched.append(match)

    if matched:
        note = f"{len(matched)} file(s) referenced by this investigation's evidence."
    else:
        note = "This issue's evidence doesn't reference any specific files in the repository."

    return AskVisual(kind="architecture_impact", data={"matched_files": matched, "note": note})


def _build_precedent(repo_name: str, current_investigation_id: str, current_decision: str | None) -> AskVisual:
    """Real SQLite aggregate over completed investigations for this repo."""
    others = [
        inv
        for inv in db.list_investigations()
        if inv["repo_name"] == repo_name
        and inv["id"] != current_investigation_id
        and inv.get("status") == "done"
        and inv.get("decision") is not None
    ]

    by_decision = {action: 0 for action in DECISION_ACTIONS}
    for inv in others:
        decision = inv["decision"]
        if decision in by_decision:
            by_decision[decision] += 1

    most_similar_reason: str | None = None
    if current_decision:
        # others is already newest-first (list_investigations order preserved by the filter above).
        for inv in others:
            if inv["decision"] == current_decision and inv.get("decision_reason"):
                most_similar_reason = inv["decision_reason"]
                break

    return AskVisual(
        kind="precedent",
        data={
            "total": len(others),
            "by_decision": by_decision,
            "most_similar_reason": most_similar_reason,
        },
    )


def _build_queue_summary(repo_name: str, question: str) -> AskResponse | None:
    """Answer meta-questions about the current investigation queue directly
    from real SQLite data, bypassing RAG entirely. RAG only finds semantic
    matches to issue *content* — it has no way to answer "what needs my
    attention" or "how many duplicates were found," which are questions
    about aggregate state, not about any single issue's text. Mirrors the
    same keyword categories CommandPalette.tsx already uses client-side
    (attention/duplicate/escalate), so both surfaces agree on what these
    questions mean. Returns None if the question doesn't match any known
    meta-question shape, so the caller falls through to RAG retrieval."""
    q = question.lower()

    investigations = [i for i in db.list_investigations() if i["repo_name"] == repo_name]
    # Same repeated-issue dedup as Command Center / the weekly brief.
    seen_numbers: set[int] = set()
    deduped: list[dict] = []
    for inv in investigations:
        if inv["number"] in seen_numbers:
            continue
        seen_numbers.add(inv["number"])
        deduped.append(inv)
    investigations = deduped

    def _issue_list(items: list[dict]) -> str:
        return ", ".join(f"#{i['number']}" for i in items) if items else "none"

    if "attention" in q or "care about" in q:
        needs_attention = [i for i in investigations if i.get("decision") == "escalate" or i.get("status") == "running"]
        category, items = "attention", needs_attention
    elif "duplicate" in q:
        items = [i for i in investigations if i.get("decision") == "close_as_duplicate"]
        category = "duplicates"
    elif "escalat" in q:
        items = [i for i in investigations if i.get("decision") == "escalate"]
        category = "escalations"
    elif "security" in q:
        items = []
        for inv in investigations:
            try:
                steps = db.get_steps(inv["id"])
            except Exception:
                continue
            if any(ev.get("type") == "security" for ev in _flatten_evidence(steps)):
                items.append(inv)
        category = "security signals"
    elif "precedent" in q or "maintainer" in q:
        by_decision = {action: 0 for action in DECISION_ACTIONS}
        for inv in investigations:
            if inv.get("decision") in by_decision:
                by_decision[inv["decision"]] += 1
        total = sum(by_decision.values())
        if total == 0:
            return _insufficient_evidence_response(
                f"No completed investigations recorded yet for {repo_name} to establish a precedent."
            )
        lines = [f"{count} {action}" for action, count in by_decision.items() if count > 0]
        answer = f"Across {total} completed investigations in {repo_name}: " + ", ".join(lines) + "."
        return AskResponse(
            answer=answer,
            visuals=[AskVisual(kind="precedent", data={"total": total, "by_decision": by_decision, "most_similar_reason": None})],
            citations=[],
            confidence=None,
            insufficient_evidence=False,
            suggested_actions=[],
        )
    else:
        return None

    if not investigations:
        return _insufficient_evidence_response(
            f"No investigations have been run against {repo_name} yet, so there's nothing to report on {category}."
        )

    if not items:
        answer = f"Nothing currently falls under {category} for {repo_name}."
    else:
        answer = f"{len(items)} investigation(s) under {category} in {repo_name}: {_issue_list(items)}."

    citations = [
        AskCitation(
            type="decision",
            ref=str(inv["number"]),
            score=inv.get("confidence"),
            snippet=inv.get("title") or inv.get("decision_reason") or "",
            number=inv["number"],
        )
        for inv in items[:10]
    ]

    return AskResponse(
        answer=answer,
        visuals=[],
        citations=citations,
        confidence=None,
        insufficient_evidence=False,
        suggested_actions=[],
    )


def _build_context_block(
    investigation: dict, citations: list[AskCitation], precedent_visual: AskVisual
) -> str:
    lines = [
        f"Repository: {investigation['repo_name']}",
        f"Issue/PR #{investigation['number']}: {investigation.get('title') or ''}",
        f"Decision: {investigation.get('decision')}",
        f"Decision reason: {investigation.get('decision_reason')}",
        f"Confidence: {investigation.get('confidence')}",
        "Evidence:",
    ]
    for c in citations:
        lines.append(f"- [{c.type}] ref={c.ref} score={c.score} :: {c.snippet}")
    precedent = precedent_visual.data
    lines.append(
        f"Precedent in this repo: {precedent['total']} other completed investigations, "
        f"by decision: {precedent['by_decision']}."
    )
    if precedent.get("most_similar_reason"):
        lines.append(f"Most similar past reasoning: {precedent['most_similar_reason']}")
    return "\n".join(lines)


ASK_SYSTEM_PROMPT = """You are RepoGuardian, an assistant explaining why an automated issue-triage \
system made the decision it made. Answer the user's question using ONLY the evidence and context \
block provided below. Do not invent issue numbers, file paths, scores, or confidence values that \
are not present in the context. If the evidence is thin or doesn't fully answer the question, say \
so plainly in your answer rather than filling the gap with a guess. Be concise and specific, citing \
evidence types (e.g. "the security scanner flagged...", "a 91% similarity match to #12...") drawn \
directly from the context."""


@router.post("/api/ask", response_model=AskResponse)
async def ask(payload: AskRequest) -> AskResponse:
    try:
        investigation = _resolve_investigation(payload)

        if investigation is None:
            queue_summary = _build_queue_summary(payload.repo_name, payload.question)
            if queue_summary is not None:
                return queue_summary

            # No investigation context resolvable — fall back to general
            # retrieval over the repo's indexed issue corpus.
            try:
                hits = retrieve_with_scores(payload.question, payload.repo_name, "issues", k=5)
            except Exception:
                logger.exception("general retrieval failed for %s", payload.repo_name)
                hits = []

            # Compare the CLAMPED score against the threshold — Chroma's
            # similarity_search_with_relevance_scores can return values
            # outside [0, 1] on a small/sparse collection (see
            # api/routes_repos.py's query_memory for the same clamp), and
            # comparing the raw score here made every genuinely-relevant
            # match with a slightly-off raw score fail the threshold too.
            meaningful = [h for h in hits if _clamp01(h[1]) >= MIN_GENERAL_RETRIEVAL_SCORE]
            if not meaningful:
                return _insufficient_evidence_response(
                    "I don't have enough repository history to answer that confidently."
                )

            citations = [
                AskCitation(
                    type="duplicate",
                    ref=str((doc.metadata or {}).get("number", "")),
                    score=_clamp01(score),
                    snippet=doc.page_content.split("\n", 1)[0],
                    number=(doc.metadata or {}).get("number"),
                )
                for doc, score in meaningful
            ]
            context_lines = ["General repository context (no specific investigation matched):"]
            for c in citations:
                context_lines.append(f"- [{c.type}] ref={c.ref} score={c.score} :: {c.snippet}")
            context = "\n".join(context_lines)

            answer = llm.invoke(
                [
                    SystemMessage(content=ASK_SYSTEM_PROMPT),
                    HumanMessage(content=f"Context:\n{context}\n\nQuestion: {payload.question}"),
                ]
            ).content

            return AskResponse(
                answer=answer,
                visuals=[],
                citations=citations,
                confidence=None,
                insufficient_evidence=False,
                suggested_actions=[],
            )

        # Grounded path: real investigation with recorded steps/evidence.
        steps = db.get_steps(investigation["id"])
        evidence = _flatten_evidence(steps)
        citations = _build_citations(evidence, investigation.get("number"))

        visuals: list[AskVisual] = []
        evidence_bar = _build_evidence_bar(evidence)
        if evidence_bar:
            visuals.append(evidence_bar)
        similar_incidents = _build_similar_incidents(evidence)
        if similar_incidents:
            visuals.append(similar_incidents)
        architecture_impact = _build_architecture_impact(evidence, investigation["repo_name"])
        visuals.append(architecture_impact)
        precedent_visual = _build_precedent(
            investigation["repo_name"], investigation["id"], investigation.get("decision")
        )
        visuals.append(precedent_visual)

        suggested_actions = ["open_investigation"]
        if architecture_impact.data["matched_files"]:
            suggested_actions.append("view_architecture")
            suggested_actions.append("view_code_path")

        context = _build_context_block(investigation, citations, precedent_visual)
        answer = llm.invoke(
            [
                SystemMessage(content=ASK_SYSTEM_PROMPT),
                HumanMessage(content=f"Context:\n{context}\n\nQuestion: {payload.question}"),
            ]
        ).content

        return AskResponse(
            answer=answer,
            visuals=visuals,
            citations=citations,
            confidence=investigation.get("confidence"),
            insufficient_evidence=False,
            suggested_actions=suggested_actions,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("ask handler failed for repo=%s question=%r", payload.repo_name, payload.question)
        return _insufficient_evidence_response(
            f"I hit an internal error trying to answer that ({e}); please try again or narrow the question."
        )
