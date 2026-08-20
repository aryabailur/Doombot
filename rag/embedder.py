from mcp_server.github_client import get_repo_files
from mcp_server.github_client import get_file_content
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
        collection_name=repo_name.replace("/","-")
    )
    return vector_db


    
