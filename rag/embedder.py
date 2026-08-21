from mcp_server.github_client import get_repo_files
from mcp_server.github_client import get_file_content
from mcp_server.github_client import get_issues
from langchain_core.documents import Document
import os
from pathlib import Path

# langchain_huggingface, langchain_chroma, and langchain_text_splitters are
# imported INSIDE the functions
# that need them, not here. langchain_huggingface transitively imports torch,
# which costs ~4s and ~200MB of RSS. agents/ modules import this file to reach
# the retriever, and a node that never embeds anything should not pay that.
# Deferring the import is what actually makes `import rag.embedder` cheap --
# the lazy _model singleton alone does not, since the module-level import
# already happened.

# Lazy module-level singleton — importing this module must be cheap.
# The model is only loaded the first time something actually needs to
# embed or query, and every subsequent call reuses the same instance.
_model = None


def _get_model():
    """Lazily construct and cache the local MiniLM embedding model."""
    global _model
    if _model is None:
        from langchain_huggingface import HuggingFaceEmbeddings

        _model = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")
    return _model


def get_collection(repo_name: str, kind: str):
    """Open (not rebuild) the named collection for this repo.

    kind is "code" or "issues". Collection name is
    f"{repo_name.replace('/','-')}-{kind}".
    """
    # Repo-root relative for the same reason as DB_PATH: an MCP client's cwd
    # is not ours, and "./chroma_db" there is an empty new store, so every
    # semantic search would return nothing at all.
    # Repo-root relative when relative, for the same reason as DB_PATH: an MCP
    # client's cwd is not ours, and a relative "./chroma_db" there is a brand
    # new empty store, so every semantic search returns nothing.
    _root = Path(__file__).resolve().parents[1]
    _configured = Path(os.environ.get("CHROMA_DIR") or "chroma_db")
    persist_directory = str(
        _configured if _configured.is_absolute() else _root / _configured
    )
    collection_name = f"{repo_name.replace('/', '-')}-{kind}"
    from langchain_chroma import Chroma

    return Chroma(
        persist_directory=persist_directory,
        embedding_function=_get_model(),
        collection_name=collection_name,
    )


def index_repo_files(repo_name: str) -> int:
    """Chunk and (re)index every source file in the repo into `{repo}-code`.

    Keeps RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=50)
    exactly as before — code chunking policy is unchanged. Deterministic
    ids so re-running upserts instead of duplicating.
    """
    file_paths = get_repo_files(repo_name)
    file_content = []
    for file in file_paths:
        file_content.append(get_file_content(repo_name, file))

    from langchain_text_splitters import RecursiveCharacterTextSplitter

    text_split = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=50)
    file_content_list = []
    for i, file in enumerate(file_content):
        file_content_doc = Document(
            page_content=file,
            metadata={"type": "file", "source": file_paths[i]},
        )
        file_content_list.append(file_content_doc)
    split_file_content_doc = text_split.split_documents(file_content_list)

    # Build deterministic ids per (path, chunk_index) so re-running this
    # function upserts existing chunks instead of duplicating them.
    per_source_index = {}
    ids = []
    for doc in split_file_content_doc:
        source = doc.metadata.get("source", "")
        idx = per_source_index.get(source, 0)
        ids.append(f"file-{source}-{idx}")
        per_source_index[source] = idx + 1

    vector_db = get_collection(repo_name, "code")
    if split_file_content_doc:
        vector_db.add_documents(documents=split_file_content_doc, ids=ids)
    return len(split_file_content_doc)


def _epoch_seconds(value) -> int:
    """An ISO-8601 timestamp as epoch seconds, or 0 when it cannot be read.

    0 rather than None: Chroma metadata cannot hold None, and a sentinel that
    sorts before every real issue keeps an unparseable date out of every
    "created after" window instead of into all of them.
    """
    from datetime import datetime

    text = str(value or "").strip()
    if not text:
        return 0
    try:
        return int(datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp())
    except ValueError:
        return 0


def index_issues(repo_name: str, state: str = "all", limit: int = 200) -> int:
    """Index (or upsert) issues into `{repo}-issues`, one Document per issue.

    CRITICAL: DO NOT CHUNK ISSUES. Chunking destroys duplicate detection —
    duplicate search works by comparing whole-issue-to-whole-issue meaning.
    If an issue body is split into fragments, a similarity search against
    another issue's full text ends up comparing partial paragraphs against
    whole documents, producing spurious partial-sentence matches and losing
    the title+full-context comparison that makes "this is the same bug
    report" a well-formed nearest-neighbor comparison in the first place.
    One Document per issue, never split, no matter how long the body is.
    """
    issues = get_issues(repo_name, state=state, limit=limit)

    docs = []
    ids = []
    for issue in issues:
        title = issue.get("title", "")
        body = issue.get("body", "") or ""
        labels = issue.get("labels", []) or []
        doc = Document(
            page_content=f"{title}\n\n{body}",
            metadata={
                "type": "issue",
                "number": issue["number"],
                "state": issue.get("state", ""),
                # Chroma metadata values must be str/int/float/bool — join
                # the labels list into a comma-separated string, not a list.
                "labels": ",".join(labels),
                "created_at": issue.get("created_at", ""),
                "author": issue.get("author", ""),
                # Engagement signals. get_issues() already returns these, but
                # they were not being persisted, so rag.graph read them back
                # as 0 for every issue -- which made node size a constant and
                # silently killed one of the graph's four visual encodings.
                "reactions": int(issue.get("reactions") or 0),
                "comments": int(issue.get("comments") or 0),
                # The same timestamp as `created_at`, as epoch seconds.
                #
                # Chroma's range operators reject strings -- filtering
                # `created_at` with $gte raises "Expected operand value to be an
                # int or a float" -- so a date window cannot be expressed in the
                # query against the ISO field. Semantic search needs date
                # windows, and doing them in the query rather than as a
                # post-filter is what keeps them from silently returning almost
                # nothing. Duplicated rather than replacing `created_at`:
                # everything else reads that field, and 8 bytes per issue is
                # cheaper than a migration.
                "created_ts": _epoch_seconds(issue.get("created_at")),
            },
        )
        docs.append(doc)
        ids.append(f"issue-{issue['number']}")

    vector_db = get_collection(repo_name, "issues")
    if docs:
        # add_documents upserts on matching ids instead of rebuilding the
        # whole collection, unlike Chroma.from_documents.
        vector_db.add_documents(docs, ids=ids)
    return len(docs)


def embeder(repo_name):
    """Backwards-compatible wrapper — app.py imports this exact name."""
    return index_repo_files(repo_name)
