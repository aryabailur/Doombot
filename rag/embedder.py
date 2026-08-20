from mcp_server.github_client import get_repo_files
from mcp_server.github_client import get_file_content
from mcp_server.github_client import get_issues
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_core.documents import Document
from langchain_chroma import Chroma

_model = None


def _get_model():
    global _model
    if _model is None:
        _model = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")
    return _model


def get_collection(repo_name: str, kind: str = "issues") -> Chroma:
    """Open an existing collection for reading, without indexing anything.

    Added for the graph builders (F15), which read the vectors that
    `index_issues` and `embeder` already wrote rather than embedding again.
    Purely additive: the indexing functions keep constructing their own
    handles exactly as before.

    The Chroma configuration is duplicated from those functions on purpose --
    persist_directory, the collection-name suffix, and the cosine space must
    all match or this silently opens a *different*, empty collection and every
    graph comes back with no nodes. If the indexing config ever changes, this
    has to change with it.
    """
    if kind not in ("issues", "code"):
        raise ValueError(f"unknown collection kind: {kind!r}")

    return Chroma(
        persist_directory="./chroma_db",
        embedding_function=_get_model(),
        collection_name=repo_name.replace("/", "-") + f"-{kind}",
        collection_metadata={"hnsw:space": "cosine"},
    )


def embeder(repo_name):
    file_paths=get_repo_files(repo_name)
    file_content=[]
    for file in file_paths:
        file_content.append(get_file_content(repo_name,file))
    
    
    text_split=RecursiveCharacterTextSplitter(chunk_size=500,chunk_overlap=50)
    file_content_list=[]
    for i,file in enumerate(file_content):
        file_content_doc=Document(page_content=file, metadata={"source": file_paths[i]})
        file_content_list.append(file_content_doc)
    split_file_content_doc=text_split.split_documents(file_content_list)



    vector_db=Chroma.from_documents(
        documents=split_file_content_doc,
        embedding=_get_model(),
        persist_directory="./chroma_db",
        collection_name=repo_name.replace("/","-")+"-code",
        collection_metadata={"hnsw:space": "cosine"},
    )
    return vector_db


def index_issues(repo_name: str, state: str = "all", limit: int = 100):
    """Index repo issues into a dedicated {repo}-issues collection.

    One Document per issue, unchunked (chunking destroys duplicate
    detection by comparing fragments instead of whole issues). Chroma
    upserts by id, so re-running is idempotent and cheap.
    """
    issues = get_issues(repo_name, state=state, limit=limit)
    docs = []
    ids = []
    for issue in issues:
        docs.append(
            Document(
                page_content=f"{issue['title']}\n\n{issue['body']}",
                metadata={
                    "type": "issue",
                    "number": issue["number"],
                    "state": issue["state"],
                    "labels": ",".join(issue.get("labels", [])),
                },
            )
        )
        ids.append(f"issue-{issue['number']}")

    if not docs:
        return None

    vector_db = Chroma(
        persist_directory="./chroma_db",
        embedding_function=_get_model(),
        collection_name=repo_name.replace("/", "-") + "-issues",
        collection_metadata={"hnsw:space": "cosine"},
    )
    vector_db.add_documents(docs, ids=ids)
    return vector_db


    
