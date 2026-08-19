import warnings

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

    CRITICAL — score direction: this MUST use
    similarity_search_with_relevance_scores, which returns a normalized
    0-1 score where HIGHER IS BETTER. Do NOT use
    similarity_search_with_score — that returns raw L2 distance, where
    LOWER IS BETTER, and the two are easy to silently swap since both
    return (Document, float) tuples. Inverting the number to "fix" the
    scale is the classic bug this comment exists to prevent; always call
    the *_relevance_scores variant instead.
    """
    vector_db = get_collection(repo_name, kind)

    # Chroma defaults to an L2 collection, and LangChain's L2->relevance
    # conversion is `1 - distance/sqrt(2)`, which goes NEGATIVE for anything
    # semantically distant -- an unrelated issue measured -0.35 in testing.
    # LangChain warns about that on every call, from inside its own code, so
    # the filter has to go here rather than around our clamp below.
    # The warning is expected and harmless: our thresholds (>0.85 duplicate,
    # >=0.65 related) assume a true 0-1 scale, and clamping is safe for
    # bucketing because everything below 0.65 is dropped anyway -- the only
    # values that survive were already in range.
    with warnings.catch_warnings():
        warnings.filterwarnings(
            "ignore",
            message="Relevance scores must be between",
            category=UserWarning,
        )
        results = vector_db.similarity_search_with_relevance_scores(query, k=k)

    return [(doc, max(0.0, min(1.0, score))) for doc, score in results]


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
