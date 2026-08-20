"""Issue relationship graph (F15).

Builds a `{nodes, links}` structure from the repository's own indexed
history, for the force-directed graph in the dashboard.

No new ML pipeline: the relationships already exist. Node embeddings come
from the `{repo}-issues` Chroma collection that duplicate detection already
populates, so this is a read over data the triage graph produced.

Three edge signals, per STRETCH_FEATURES.md 15:
  similarity  cosine between issue embeddings (the RAG signal)
  reference   issue #X literally mentions issue #Y in its body
  metadata    shared labels

The output format matches react-force-graph's `{nodes, links}` contract, so
the 2D and 3D components are a one-line swap.
"""

from __future__ import annotations

import itertools
import re

# Thresholds mirror rag/retriever.find_duplicates so the graph and the
# duplicate detector never disagree about what "similar" means.
DUPLICATE_THRESHOLD = 0.85
RELATED_THRESHOLD = 0.65

# Below this, an edge is noise: with 50+ issues, every pair has *some*
# similarity, and drawing all of them produces a hairball that communicates
# nothing. This is the whole reason the graph is readable.
EDGE_FLOOR = RELATED_THRESHOLD

# "#123" but not "#12345678" (a commit-ish number) and not inside a word.
_ISSUE_REF = re.compile(r"(?<![\w#])#(\d{1,6})(?!\d)")


def _cosine(a: list[float], b: list[float]) -> float:
    """Cosine similarity between two vectors, without pulling in numpy.

    MiniLM emits L2-normalized vectors, so the dot product *is* the cosine.
    The norms are computed anyway because relying on an upstream invariant
    that a model swap could silently break is how a scoring bug gets in.
    """
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(x * x for x in b) ** 0.5
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return max(0.0, min(1.0, dot / (norm_a * norm_b)))


def _category(metadata: dict, security_numbers: set[int]) -> str:
    """Triage category driving node colour.

    Order matters and mirrors the decider's priority: a security issue that
    is also a duplicate is still a security issue.
    """
    number = metadata.get("number")
    if number in security_numbers:
        return "security"
    if metadata.get("state") == "closed":
        return "resolved"
    labels = str(metadata.get("labels") or "").lower()
    if "duplicate" in labels:
        return "duplicate"
    if "stale" in labels:
        return "stale"
    return "open"


def _references(body: str, own_number: int, known: set[int]) -> set[int]:
    """Issue numbers explicitly mentioned in this issue's text.

    Self-references and numbers that are not issues in this repo are dropped
    -- a stray "#404" in a stack trace should not draw an edge.
    """
    found = {int(match) for match in _ISSUE_REF.findall(body or "")}
    return {number for number in found if number != own_number and number in known}


def build_graph(repo_name: str, security_numbers: set[int] | None = None) -> dict:
    """Compute the issue relationship graph for a repository.

    Args:
        repo_name: "owner/repo".
        security_numbers: issue numbers the security scanner flagged, used
            for node colour. Optional -- the graph is still useful without it.

    Returns:
        {"nodes": [...], "links": [...], "stats": {...}} -- react-force-graph's
        expected shape. Returns empty lists (never raises) when the repo has
        not been indexed, so the UI renders an empty state instead of an error.
    """
    from rag.embedder import get_collection

    security = security_numbers or set()

    try:
        collection = get_collection(repo_name, "issues")
        # Chroma omits embeddings by default; ask for them explicitly.
        raw = collection.get(include=["metadatas", "documents", "embeddings"])
    except Exception:
        return {"nodes": [], "links": [], "stats": _stats([], [])}

    metadatas = raw.get("metadatas") or []
    documents = raw.get("documents") or []
    embeddings = raw.get("embeddings")
    embeddings = list(embeddings) if embeddings is not None else []

    nodes: list[dict] = []
    vectors: dict[int, list[float]] = {}
    bodies: dict[int, str] = {}

    for index, metadata in enumerate(metadatas):
        number = metadata.get("number")
        if number is None:
            continue

        content = documents[index] if index < len(documents) else ""
        title = (content or "").split("\n", 1)[0].strip() or f"Issue #{number}"

        # Engagement drives node size. Chroma metadata is scalar-only, so
        # these may be absent on issues indexed before the field existed.
        engagement = int(metadata.get("reactions") or 0) + int(
            metadata.get("comments") or 0
        )

        nodes.append({
            "id": f"issue-{number}",
            "number": number,
            "title": title,
            "category": _category(metadata, security),
            "state": metadata.get("state", "open"),
            "labels": [
                label
                for label in str(metadata.get("labels") or "").split(",")
                if label
            ],
            "engagement": engagement,
            "escalated": number in security,
        })

        if index < len(embeddings):
            vectors[number] = list(embeddings[index])
        bodies[number] = content

    known = {node["number"] for node in nodes}
    links: list[dict] = []
    seen: set[tuple[int, int]] = set()

    # --- similarity edges ---------------------------------------------------
    for left, right in itertools.combinations(sorted(vectors), 2):
        score = _cosine(vectors[left], vectors[right])
        if score < EDGE_FLOOR:
            continue
        seen.add((left, right))
        links.append({
            "source": f"issue-{left}",
            "target": f"issue-{right}",
            "kind": "duplicate" if score > DUPLICATE_THRESHOLD else "similar",
            "score": round(score, 3),
            # Rendered verbatim when a maintainer clicks the edge. An edge a
            # human cannot interrogate is decoration, not evidence.
            "why": f"{round(score, 2)} cosine similarity",
        })

    # --- reference edges ----------------------------------------------------
    for number, body in bodies.items():
        for target in _references(body, number, known):
            pair = tuple(sorted((number, target)))
            if pair in seen:
                # A reference is stronger evidence than a similarity score, so
                # it upgrades the existing edge rather than stacking a second
                # line between the same two nodes.
                for link in links:
                    if {link["source"], link["target"]} == {
                        f"issue-{pair[0]}",
                        f"issue-{pair[1]}",
                    }:
                        link["kind"] = "reference"
                        link["why"] += f", and #{number} references #{target}"
                        break
                continue
            seen.add(pair)
            links.append({
                "source": f"issue-{number}",
                "target": f"issue-{target}",
                "kind": "reference",
                "score": 1.0,
                "why": f"#{number} references #{target}",
            })

    # --- shared-label edges -------------------------------------------------
    by_label: dict[str, list[int]] = {}
    for node in nodes:
        for label in node["labels"]:
            by_label.setdefault(label, []).append(node["number"])

    for label, numbers in by_label.items():
        # A label shared by most of the repo (like "bug") connects everything
        # to everything and destroys the clustering the graph exists to show.
        if len(numbers) < 2 or len(numbers) > max(2, len(nodes) // 3):
            continue
        for left, right in itertools.combinations(sorted(numbers), 2):
            pair = (left, right)
            if pair in seen:
                continue
            seen.add(pair)
            links.append({
                "source": f"issue-{left}",
                "target": f"issue-{right}",
                "kind": "metadata",
                "score": 0.5,
                "why": f"shared label: {label}",
            })

    return {"nodes": nodes, "links": links, "stats": _stats(nodes, links)}


def _stats(nodes: list[dict], links: list[dict]) -> dict:
    """Counts the UI shows without walking the whole graph itself."""
    return {
        "node_count": len(nodes),
        "link_count": len(links),
        "duplicate_links": sum(1 for link in links if link["kind"] == "duplicate"),
        "by_category": {
            category: sum(1 for node in nodes if node["category"] == category)
            for category in ("security", "duplicate", "stale", "resolved", "open")
        },
    }
