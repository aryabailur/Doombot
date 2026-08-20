from langchain_chroma import Chroma
from rag.embedder import _get_model

def retrieve(query,repo_name):
    vector_db=Chroma(
        persist_directory="./chroma_db",
        embedding_function=_get_model(),
        collection_name=repo_name.replace("/","-")
    )
    results=vector_db.similarity_search(query,k=3)
    return results