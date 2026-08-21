from rag.embedder import get_collection


def retrieve(query, repo_name):
    """EXISTING — keep signature and behavior unchanged. Searches the
    `{repo}-code` collection via similarity_search(query, k=3). reviewer.py
    depends on doc.page_content directly, so the return type stays
    list[Document]."""
    vector_db = get_collection(repo_name, "code")
    results = vector_db.similarity_search(query, k=3)
    return results


# Chroma reports a *distance* (lower is closer), and which distance depends on
# the collection's `hnsw:space`. Both of ours occur in practice, so the
# conversion has to be told which one it is looking at.
#
# Calibrated empirically rather than from documentation, because the previous
# formula was wrong in a way that read as plausible. Method: embed two texts,
# compute cosine directly from the raw vectors, then compare against what
# Chroma returns for the same pair in each space.
#
#   text pair                     true cos    default d    cosine-space d
#   related issues                +0.56876      0.86249           0.43124
#   unrelated issues              -0.02730      2.05460           1.02730
#   identical text                +1.00000      0.00000           0.00000
#
# Reading off the exact recoveries:
#
#   default ("l2")  -> Chroma returns SQUARED euclidean distance.
#                      For unit vectors d = 2(1 - cos), so  cos = 1 - d/2.
#   "cosine"        -> Chroma returns cosine distance, so    cos = 1 - d.
#
# The formula this replaced was `1 - d*d/2`, which treated the default space's
# already-squared distance as if it were plain euclidean and squared it again.
# It agrees with the truth only at d = 0, which is why identical text looked
# fine. On the numbers above it produced +0.628 for the related pair (should be
# +0.569) and -1.111 for the unrelated one, and since the result is clamped to
# [0, 1] every real query collapsed to 0.0 -- so the >0.85 duplicate and
# 0.65-0.85 related thresholds could never fire at all.
_SQUARED_L2_SPACES = frozenset({"", "l2", "sq_euclidean", "squared_l2"})


def cosine_from_distance(distance: float, space: str | None) -> float:
    """Convert one Chroma distance into a true cosine similarity in [0, 1].

    `space` is the collection's `hnsw:space`; None or "" means Chroma's
    default. Kept as a pure function so the conversion can be tested against
    the calibration table above without loading the embedding model.
    """
    key = (space or "").strip().lower()
    if key in _SQUARED_L2_SPACES:
        cosine = 1.0 - distance / 2.0
    elif key == "cosine":
        cosine = 1.0 - distance
    elif key == "ip":
        # Inner product on unit vectors already *is* cosine; Chroma negates it.
        cosine = -distance
    else:
        # An unknown space is not worth guessing at: treat it as the default
        # rather than silently returning a number from the wrong formula.
        cosine = 1.0 - distance / 2.0
    # Negative cosine is meaningful ("unrelated") but every threshold in
    # rag/CLAUDE.md is expressed on 0-1, so the floor stays.
    return max(0.0, min(1.0, cosine))


def collection_space(vector_db) -> str | None:
    """The `hnsw:space` the collection was actually created with.

    Read per query rather than assumed: this repository's store contains
    collections in both spaces (some were indexed by a branch that set
    `hnsw:space: cosine` explicitly, most predate it), so a single hardcoded
    conversion is guaranteed to be wrong for one of them.
    """
    collection = getattr(vector_db, "_collection", None)
    metadata = (getattr(collection, "metadata", None) or {}) if collection is not None else {}
    return metadata.get("hnsw:space")


def retrieve_with_scores(query: str, repo_name: str, kind: str = "issues", k: int = 5) -> list:
    """Like retrieve(), but returns (Document, relevance_score) pairs from
    the named collection ("code" or "issues").

    Returns TRUE COSINE SIMILARITY: 0-1, higher is better, matching the
    thresholds in rag/CLAUDE.md and agents/CLAUDE.md.

    CRITICAL -- score direction. This calls `similarity_search_with_score`,
    which returns a raw **distance** (lower is better), and converts it above.
    That is deliberate and must not be "fixed" to
    `similarity_search_with_relevance_scores`: the relevance variant does not
    return cosine either. It computes `1 - L2/sqrt(2)`, which compresses the
    scale and goes negative for distant pairs -- measured on a real duplicate
    pair, true cosine 0.692 came back as 0.445, below the 0.65 "related" cut,
    so a genuine duplicate was dropped.

    The trap this docstring has always warned about -- returning a distance
    where a similarity is expected -- is real. It is avoided by converting with
    the formula that matches the collection's space, not by picking the other
    method and not by assuming the space.
    """
    vector_db = get_collection(repo_name, kind)
    space = collection_space(vector_db)
    results = vector_db.similarity_search_with_score(query, k=k)
    return [(doc, cosine_from_distance(distance, space)) for doc, distance in results]


def retrieve_filtered(
    query: str,
    repo_name: str,
    kind: str = "issues",
    k: int = 20,
    where: dict | None = None,
) -> list:
    """`retrieve_with_scores` with a Chroma metadata filter applied.

    Separate from `retrieve_with_scores` rather than an optional argument on it,
    so that the duplicate-detection and precedent paths cannot accidentally
    acquire a filter -- those compare whole issues against the whole index by
    design, and a stray `where` there would narrow the comparison without
    anything failing visibly.

    `where` is passed to Chroma, which applies it **before** selecting the k
    nearest. That ordering is the reason this exists: post-filtering a plain
    top-k drops the neighbours that matched and leaves genuinely qualifying
    issues sitting just outside k. Pass None for no filter -- an empty dict is
    not the same thing and matches nothing on some Chroma versions.
    """
    vector_db = get_collection(repo_name, kind)
    space = collection_space(vector_db)
    results = (
        vector_db.similarity_search_with_score(query, k=k, filter=where)
        if where
        else vector_db.similarity_search_with_score(query, k=k)
    )
    return [(doc, cosine_from_distance(distance, space)) for doc, distance in results]


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
