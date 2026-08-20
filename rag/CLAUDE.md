# rag/ — Indexing, Retrieval, and Duplicate Detection

**Owner: Person B (Stream B).** Branch prefix `feat/b-<slug>`. Read the root
`CLAUDE.md` first, and `agents/CLAUDE.md` if you haven't — `duplicate_detector`
is this package's primary consumer and its contract shapes what's specified
here.

---

## 1. Purpose

Project-aware RAG over **the repo's own history** — not a general knowledge
base, not docs, not Stack Overflow. Two things Doombot needs vector search
for:

1. **Code context for PR review** — `agents/reviewer.py` already calls
   `rag.retriever.retrieve(query, repo_name)` to pull similar code chunks
   while reviewing a diff. This exists and works; keep it working.
2. **Duplicate issue detection for triage** — `agents/triage/duplicate_detector.py`
   needs to find semantically similar *past issues* in the same repo. This
   is new, and it's why this file introduces a second collection and a new
   `find_duplicates` function.

---

## 2. Two collections, not one with metadata filtering

Every repo gets **two** Chroma collections, keyed off `repo_name`:

```python
def _collection_name(repo_name: str, kind: str) -> str:
    """kind is "code" or "issues". Returns e.g. "aryabailur-Doombot-code"."""
    return f"{repo_name.replace('/', '-')}-{kind}"
```

- `{repo}-code` — chunked source file content (existing behavior, from
  `embedder.py`'s current `Chroma.from_documents` call).
- `{repo}-issues` — one document per issue (new, §3).

### Why two collections beat one collection + a metadata filter

The obvious alternative is one collection per repo with a `type: "code" |
"issue"` metadata field, and filter at query time
(`vector_db.similarity_search(query, k=3, filter={"type": "issue"})`).
Don't do that here:

- **Duplicate search must never see code.** `find_duplicates` always wants
  100% of its results to come from the issue corpus. A metadata filter is an
  extra parameter that can be forgotten or typo'd at a call site; a separate
  collection makes it structurally impossible to leak code chunks into a
  duplicate-issue search.
- **Chunking policy differs per corpus** (§3) — code is split into ~500-char
  chunks, issues are not split at all. Mixing chunked and unchunked
  documents in one collection means a single similarity search compares
  apples (a 500-char code fragment) to oranges (a full issue body), which
  skews scores in ways that are hard to reason about. Separate collections
  keep each corpus's documents comparable to each other.
- **Faster queries.** Chroma's per-collection index is smaller and more
  relevant with no filter step, which matters when triage needs a duplicate
  check as one node in a chain that's meant to feel fast and "live" for the
  demo.

---

## 3. **CRITICAL: do not chunk issues**

`rag/embedder.py`'s existing `embeder(repo_name)` chunks repo files with
`RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=50)`. That
splitter is correct for code and must be kept exactly as configured — do not
change the chunk size or overlap.

**Issues are different: one `Document` per issue, never split.**

```python
issue_doc = Document(
    page_content=f"{issue['title']}\n\n{issue['body']}",
    metadata={
        "type": "issue",
        "number": issue["number"],
        "state": issue["state"],
        "labels": ",".join(issue.get("labels", [])),  # Chroma metadata values must be scalar — join lists to a string
        "created_at": issue["created_at"],
        "author": issue["author"],
    },
)
```

**Why chunking destroys duplicate detection:** duplicate search works by
asking "is there an existing whole issue that means roughly the same thing
as this new whole issue?" If you split issue #12's body into three 500-char
chunks, a similarity search against issue #40's full text now compares
*fragments* of #12 to the *whole* of #40. You get partial-paragraph matches
against unrelated issues that happen to share a sentence, and you lose the
comparison you actually want (title + full context against title + full
context). One document per issue is what makes "this is the same bug
report" a well-formed nearest-neighbor comparison in the first place.

If an issue body is enormous (some are), that's fine — MiniLM still
embeds it as one vector; you are trading a small amount of embedding
fidelity on outlier issues for correctness on the 95% of normal-length
issues, which is the right trade for this use case.

---

## 4. Lazy model loading

`rag/embedder.py` line 7 currently does:

```python
model = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")
```

at **module scope**. This means `import rag.embedder` — from anywhere,
including a test that only wants `_collection_name`, or a node that imports
the module just to reach an unrelated helper — loads and initializes MiniLM
into memory immediately. In a multi-process setup (API process, MCP server
subprocess, any test runner), that's the embedding model getting loaded
redundantly in every process that happens to import this module, whether or
not it ever embeds anything.

Replace it with a singleton accessor:

```python
_model = None

def _get_model() -> HuggingFaceEmbeddings:
    """Lazily construct and cache the local MiniLM embedding model.

    Importing this module must be cheap. The model is only loaded the first
    time something actually needs to embed or query, and every subsequent
    call reuses the same instance from `_model` instead of reloading it.
    """
    global _model
    if _model is None:
        _model = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")
    return _model
```

**`rag/retriever.py` line 2 currently does `from rag.embedder import
model`** — a direct reference to the old module-level name. That import
must become `from rag.embedder import _get_model` and every use of `model`
in `retriever.py` becomes `_get_model()`. This is not optional: once
`embedder.py`'s module-level `model` is deleted, the old import breaks
`retriever.py` outright.

---

## 5. Fix the deprecated import

`rag/embedder.py` line 4:

```python
from langchain_community.embeddings import HuggingFaceEmbeddings   # WRONG — deprecated, removed in current langchain_community
```

must become:

```python
from langchain_huggingface import HuggingFaceEmbeddings            # correct package for this project's langchain version
```

`langchain_huggingface` must already be (or be added to)
`requirements.txt` — if it's missing, flag it per root `CLAUDE.md` rule 10
rather than silently adding a new dependency.

---

## 6. Incremental indexing, not full rebuild

`embedder.py`'s current `embeder()` calls `Chroma.from_documents(...)` —
this **rebuilds the entire collection from scratch** every time it's
called. That's fine for a one-shot demo seed, but wrong for issues: issues
arrive continuously as the triage graph runs, and re-embedding every issue
in the repo's history on every new issue would be slow and wasteful.

Use `vector_db.add_documents(docs, ids=[...])` with **deterministic IDs**
instead:

```python
vector_db.add_documents(
    documents=[issue_doc],
    ids=[f"issue-{issue['number']}"],
)
```

Chroma treats `add_documents` with an existing ID as an **upsert** — the
old vector and metadata for that ID are replaced, not duplicated. Deterministic,
content-derived IDs (`f"issue-{number}"`, `f"file-{path}"` for file-level
re-indexing if you ever move away from `Chroma.from_documents` for code too)
are what make re-running indexing idempotent: running `index_issues(repo)`
twice on the same repo produces the same collection state both times,
instead of duplicate entries. This matters for the demo — you will
re-trigger indexing more than once while debugging, and a full rebuild or an
ID collision either wastes time or corrupts the collection.

---

## 7. Function contracts

All functions below live in `rag/embedder.py` or `rag/retriever.py` as noted.
Signatures are exact; implementations are yours to fill in per the rules
above.

### `rag/embedder.py`

```python
def _get_model() -> HuggingFaceEmbeddings:
    """Lazily construct and cache the local MiniLM embedding model. See §4."""

def get_collection(repo_name: str, kind: str) -> Chroma:
    """Open (not rebuild) the named collection for this repo.

    Args:
        repo_name: "owner/repo".
        kind: "code" or "issues".

    Returns a Chroma instance bound to persist_directory="./chroma_db" and
    collection_name=_collection_name(repo_name, kind), using _get_model()
    as the embedding function. Does not populate it — callers add documents
    separately via index_repo_files / index_issues.
    """

def index_repo_files(repo_name: str) -> Chroma:
    """Chunk and (re)index every source file in the repo into `{repo}-code`.

    This is the existing `embeder()` function, renamed for clarity and
    fixed per §4/§5. Keeps RecursiveCharacterTextSplitter(chunk_size=500,
    chunk_overlap=50) exactly as before — code chunking policy is unchanged.
    Uses get_repo_files / get_file_content from mcp_server.github_client,
    same as today.
    """

def index_issues(repo_name: str, issues: list[dict]) -> Chroma:
    """Index (or upsert) issues into `{repo}-issues`, one Document per issue.

    Args:
        repo_name: "owner/repo".
        issues: list of issue dicts, each with at least title, body, number,
            state, labels, created_at, author (shape matches issue_metadata
            from agents/triage/issue_fetcher.py / the GET_ISSUE(S) MCP tools).

    Builds one un-chunked Document per issue per §3, with the metadata
    schema in §8, and upserts via add_documents(docs, ids=[f"issue-{n}"])
    per §6. Safe to call repeatedly with overlapping issues — later calls
    overwrite matching IDs rather than duplicating them.
    """
```

### `rag/retriever.py`

```python
def retrieve(query: str, repo_name: str) -> list[Document]:
    """EXISTING — keep this signature and behavior unchanged.

    Used by agents/reviewer.py's retrieve_similar_code tool. Searches
    `{repo}-code` via similarity_search(query, k=3). Do not change its
    return type (list[Document]) since reviewer.py depends on
    doc.page_content directly.
    """

def retrieve_with_scores(query: str, repo_name: str, kind: str, k: int = 3) -> list[tuple[Document, float]]:
    """Like retrieve(), but returns (Document, relevance_score) pairs from
    the named collection ("code" or "issues") instead of bare Documents.

    MUST use similarity_search_with_relevance_scores — see §9 for why.
    This is the shared low-level primitive; find_duplicates() and any
    future scored-retrieval need are built on top of it rather than each
    reimplementing the Chroma call.
    """

def find_duplicates(issue_text: str, repo_name: str, exclude_number: int) -> list[dict]:
    """Find semantically similar past issues in `{repo}-issues`.

    Args:
        issue_text: query text, built the same way as index_issues builds
            page_content — f"{title}\\n\\n{body}" — so the query and the
            indexed documents are comparable.
        repo_name: "owner/repo".
        exclude_number: the issue number being triaged right now. MUST be
            filtered out of the results before scoring/bucketing.

    Returns a list of {"number": int, "score": float, "relation": str}
    dicts, relation being "duplicate" (score > 0.85) or "related"
    (0.65 <= score <= 0.85). Results below 0.65, and any result whose
    metadata["number"] == exclude_number, are dropped entirely — not just
    down-ranked.

    Built on retrieve_with_scores(issue_text, repo_name, "issues", k=...).
    Fetch a few more than needed (e.g. k=5) since the excluded issue may be
    among the top results and would otherwise crowd out a real match.
    """
```

**Why `exclude_number` is a parameter here, not just handled in
`agents/triage/duplicate_detector.py`:** the caller (the triage node) is
responsible for knowing which issue it's triaging, but the *filtering* has
to happen inside `find_duplicates` because that's the only place that has
access to each result's `metadata["number"]` to compare against it. Putting
the exclusion here also means every future caller of `find_duplicates` gets
this correctness for free instead of having to remember to re-implement it.

---

## 8. Metadata schema

### Issue documents (`{repo}-issues`)

| Key | Type | Notes |
|---|---|---|
| `type` | `str` | always `"issue"` |
| `number` | `int` | GitHub issue number — used for `exclude_number` filtering and for building `duplicates` results |
| `state` | `str` | `"open"` or `"closed"` |
| `labels` | `str` | comma-joined; Chroma metadata values must be scalar, not `list` |
| `created_at` | `str` | ISO-8601 |
| `author` | `str` | GitHub login |

### File documents (`{repo}-code`)

| Key | Type | Notes |
|---|---|---|
| `type` | `str` | always `"file"` |
| `source` | `str` | file path within the repo, e.g. `"agents/reviewer.py"` |

`type` is included on both so a stray cross-collection query (during
debugging, or if collections are ever merged later) is immediately
distinguishable — but it is not a substitute for the two-collection
separation in §2.

---

## 9. **CRITICAL: score direction**

Chroma exposes two different similarity APIs and they are opposite:

| Method | Returns | Direction |
|---|---|---|
| `similarity_search_with_score` | L2 **distance** | **lower is better** |
| `similarity_search_with_relevance_scores` | normalized **relevance**, roughly 0-1 | **higher is better** |

**Use `similarity_search_with_relevance_scores`, always, everywhere in this
package.** The thresholds in this doc and in `agents/CLAUDE.md`
(`> 0.85` duplicate, `0.65-0.85` related) are written for a 0-1,
higher-is-better scale. If `retrieve_with_scores` is implemented on top of
`similarity_search_with_score` instead, those thresholds are silently
inverted — the "most confident duplicate" result would carry the *lowest*
number, `> 0.85` would almost never fire, and `duplicate_detector` would
quietly stop finding real duplicates while still returning results, which
is the worst kind of bug because nothing throws an exception. This is
exactly the "invert an L2 distance" trap named in the task brief — do not
introduce it.

---

## 10. Verification

```bash
# module import is cheap: does not load MiniLM
python -c "
import time
t0 = time.time()
import rag.embedder
print('import took', time.time() - t0, 's — should be near-instant, not multi-second MiniLM load')
"

# model loads lazily, once, on first real use
python -c "
from rag.embedder import _get_model
m1 = _get_model()
m2 = _get_model()
assert m1 is m2
print('singleton ok')
"

# retriever no longer imports the deleted module-level `model`
python -c "from rag.retriever import retrieve, retrieve_with_scores, find_duplicates; print('retriever imports ok')"

# score direction sanity check against a real indexed repo (adjust repo_name)
python -c "
from rag.retriever import retrieve_with_scores
results = retrieve_with_scores('example query', 'owner/repo', 'code', k=3)
for doc, score in results:
    assert 0.0 <= score <= 1.0, f'score {score} out of 0-1 range — check similarity_search_with_relevance_scores is used'
print('scores in expected 0-1 higher-is-better range')
"

# find_duplicates excludes the query issue's own number
python -c "
from rag.retriever import find_duplicates
dupes = find_duplicates('title\\n\\nbody', 'owner/repo', exclude_number=42)
assert all(d['number'] != 42 for d in dupes)
print('exclusion ok')
"
```

---

## 11. Task breakdown

| Task | File | Branch | Depends on |
|---|---|---|---|
| Lazy model singleton + deprecated import fix | `rag/embedder.py` | `feat/b-rag-lazy-model` | — |
| Rename/refactor `embeder` -> `index_repo_files`, add `get_collection` | `rag/embedder.py` | `feat/b-rag-index-files` | `feat/b-rag-lazy-model` |
| Issue indexing (`index_issues`, unchunked docs, upsert IDs) | `rag/embedder.py` | `feat/b-rag-index-issues` | `feat/b-rag-lazy-model` |
| Retriever score-direction fix + `retrieve_with_scores` | `rag/retriever.py` | `feat/b-rag-scored-retrieval` | `feat/b-rag-lazy-model` |
| `find_duplicates` with exclusion + thresholds | `rag/retriever.py` | `feat/b-rag-find-duplicates` | `feat/b-rag-scored-retrieval`, `feat/b-rag-index-issues` |

`index_repo_files` and `index_issues` can be built in parallel once the
lazy-model fix lands, since they touch different code paths in the same
file — coordinate to avoid two people editing `rag/embedder.py`
simultaneously (see root `CLAUDE.md`: never dispatch two subagents to write
the same file).

---

## 12. Definition of done

- [ ] `rag/embedder.py` has no module-level `HuggingFaceEmbeddings(...)` call
- [ ] `_get_model()` singleton implemented and used everywhere in `embedder.py`
- [ ] `rag/retriever.py` imports `_get_model`, not the deleted `model` name
- [ ] Import is `langchain_huggingface`, not `langchain_community.embeddings`
- [ ] Issue documents are one-per-issue, never passed through
      `RecursiveCharacterTextSplitter`
- [ ] Code files still chunked at `chunk_size=500, chunk_overlap=50`, unchanged
- [ ] Issue indexing uses `add_documents(..., ids=[f"issue-{number}"])`, not
      `Chroma.from_documents`
- [ ] `{repo}-code` and `{repo}-issues` are separate collections, never one
      collection with a `type` metadata filter
- [ ] All scoring goes through `similarity_search_with_relevance_scores`
      (0-1, higher-is-better) — zero uses of `similarity_search_with_score`
- [ ] `find_duplicates` drops results with `metadata["number"] ==
      exclude_number` before bucketing
- [ ] `retrieve(query, repo_name)` signature and return type unchanged —
      `agents/reviewer.py` still works against it untouched
- [ ] All verification commands in §10 run clean against a real indexed repo

---

## 12b. Stretch feature: adaptive repository learning (F17) — built

The labeler classifies each issue on its own merits. A repository's maintainers
have usually answered that question hundreds of times already: every closed
issue is a labelled example. F17 retrieves the nearest *closed* neighbours and
uses their labels as few-shot context, so classification follows the project's
conventions rather than the model's general priors.

Implemented as `find_precedents` in this module, consumed by
`agents/triage/labeler.py`. It returns closed issues above `RELATED_THRESHOLD`
that actually carry labels, newest-most-similar first.

**The vocabulary mismatch is the part that surprises people.** A repository's
real labels are usually nothing like `ALLOWED_LABELS`: measured on yt-dlp, the
precedents come back labelled `site-bug`, `site:youtube`, `ai-policy-violation`.
Showing them is the whole point -- they encode how the project categorises -- but
the prompt must tell the model to *map* rather than copy, or every label it
emits is filtered out by the parser and the issue silently drops to
suggest-only. Verified working: yt-dlp #17404 classified with the reason
"matching prior site-bug" at 0.97 confidence, citing four precedents, while the
labels it emitted stayed inside the allowed list.

Three rules that still hold:

- **Reuse `RELATED_THRESHOLD` (0.65).** Do not introduce a second notion of
  "similar enough" — §9's score-direction warning applies here too, and a
  fourth threshold is a fourth thing to get backwards.
- **Emit the retrieved examples as step evidence**, with issue numbers and
  scores. A classification the reader cannot trace is the black box this
  product exists to replace.
- **Degrade, do not distort.** A repository with no closed issues must fall
  back to today's prompt. Never fabricate examples, and never let an empty
  history quietly lower confidence.

---

## 13. Stretch feature: issue relationship graph (F15)

**File:** `rag/graph.py`. Entry point `build_graph(repo_name, security_numbers)`,
returning `{"nodes": [...], "links": [...], "stats": {...}}` — react-force-graph's
expected shape, so the 2D and 3D components are a one-line swap.

**No new ML pipeline.** It reads the embeddings the `{repo}-issues` collection
already holds for duplicate detection, so this is a view over data the triage
graph produced. Chroma omits embeddings from `.get()` by default; they must be
requested explicitly via `include=["metadatas", "documents", "embeddings"]`.

### Three edge signals

| Kind | Source | Notes |
|---|---|---|
| `duplicate` / `similar` | Cosine between issue embeddings | Same thresholds as `find_duplicates`, so the graph and the detector never disagree |
| `reference` | `#123` in an issue body | Upgrades an existing similarity edge rather than stacking a second line — an explicit mention is stronger evidence than a score |
| `metadata` | Shared label | |

### Two rules that make it readable rather than a hairball

- **Edges below 0.65 are dropped entirely.** With 50+ issues every pair has
  *some* similarity, and drawing all of them communicates nothing.
- **A label held by more than a third of the repo is skipped.** `bug` would
  connect everything to everything and destroy the clustering the graph exists
  to show.

Every edge carries a `why` string (`"0.92 cosine similarity"`) rendered when a
maintainer clicks it. An edge you cannot interrogate is decoration, not
evidence.

Returns empty lists rather than raising when the repo is unindexed, so the UI
shows an empty state instead of an error.
