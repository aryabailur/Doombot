from mcp_server.github_client import get_repo_files
from mcp_server.github_client import get_file_content
from mcp_server.github_client import get_issues
from langchain_core.documents import Document
import os
from pathlib import Path
import re
from concurrent.futures import ThreadPoolExecutor

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

_CODE_EXTENSIONS = {
    ".py", ".js", ".jsx", ".ts", ".tsx", ".java", ".go", ".rs", ".rb",
    ".php", ".cs", ".c", ".cc", ".cpp", ".h", ".hpp", ".swift", ".kt",
}


_SYMBOL_PATTERN = re.compile(
    r"^\s*(?:export\s+)?(?:async\s+)?(?:def|class|function)\s+([A-Za-z_$][\w$]*)"
    r"|^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=",
    re.MULTILINE,
)


def _chunk_symbol(content: str) -> str:
    """Best-effort declaration name stored with a code chunk."""
    match = _SYMBOL_PATTERN.search(content)
    return next((group for group in match.groups() if group), "") if match else ""


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
    max_files = max(1, int(os.getenv("MAX_CODE_INDEX_FILES", "80")))
    file_paths = [
        path for path in get_repo_files(repo_name)
        if Path(path).suffix.lower() in _CODE_EXTENSIONS
    ]
    file_paths.sort(key=lambda path: (path.count("/"), path))
    file_paths = file_paths[:max_files]

    def read_file(path: str) -> tuple[str, str | None]:
        try:
            return path, get_file_content(repo_name, path)
        except Exception:
            return path, None

    source_content: dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=8) as pool:
        for path, content in pool.map(read_file, file_paths):
            if content is not None:
                source_content[path] = content
    file_paths = list(source_content)
    file_content = [source_content[path] for path in file_paths]

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
    source_cursor: dict[str, int] = {}
    ids = []
    for doc in split_file_content_doc:
        source = doc.metadata.get("source", "")
        idx = per_source_index.get(source, 0)
        ids.append(f"file-{source}-{idx}")
        per_source_index[source] = idx + 1
        full_content = source_content.get(source, "")
        offset = full_content.find(doc.page_content, source_cursor.get(source, 0))
        if offset < 0:
            offset = full_content.find(doc.page_content)
        if offset >= 0:
            source_cursor[source] = offset + len(doc.page_content)
        doc.metadata["line_start"] = full_content.count("\n", 0, max(0, offset)) + 1
        doc.metadata["symbol"] = _chunk_symbol(doc.page_content)

    vector_db = get_collection(repo_name, "code")
    if split_file_content_doc:
        vector_db.add_documents(documents=split_file_content_doc, ids=ids)
    return len(split_file_content_doc)


def collection_count(repo_name: str, kind: str) -> int:
    """Return indexed count without loading the embedding model."""
    import chromadb

    root = Path(__file__).resolve().parents[1]
    configured = Path(os.environ.get("CHROMA_DIR") or "chroma_db")
    persist_directory = str(
        configured if configured.is_absolute() else root / configured
    )
    client = chromadb.PersistentClient(path=persist_directory)
    try:
        collection = client.get_collection(f"{repo_name.replace('/', '-')}-{kind}")
    except Exception:
        return 0
    return int(collection.count())


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
