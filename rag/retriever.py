from langchain_chroma import Chroma
from rag.embedder import _get_model

def retrieve(query,repo_name):
    vector_db=Chroma(
        persist_directory="./chroma_db",
        embedding_function=_get_model(),
        collection_name=repo_name.replace("/","-")+"-code"
    )
    results=vector_db.similarity_search(query,k=3)
    return results


def retrieve_with_scores(query: str, repo_name: str, collection: str, k: int = 5):
    """Similarity search returning normalized 0-1 relevance scores.

    Uses similarity_search_with_relevance_scores (normalized, higher =
    better) rather than similarity_search_with_score, which returns raw
    L2 distance (lower = better) — inverting that is a classic silent bug.
    """
    vector_db = Chroma(
        persist_directory="./chroma_db",
        embedding_function=_get_model(),
        collection_name=f"{repo_name.replace('/', '-')}-{collection}",
    )
    return vector_db.similarity_search_with_relevance_scores(query, k=k)


def find_duplicates(issue_text: str, repo_name: str, exclude_number: int):
    """Find duplicate/related issues for a given issue's text.

    Must exclude the issue's own number from results — otherwise every
    issue is its own perfect duplicate. This is the single most likely
    demo-breaking bug in this feature.
    """
    try:
        results = retrieve_with_scores(issue_text, repo_name, "issues", k=10)
    except Exception:
        return {"duplicates": [], "related": []}

    duplicates = []
    related = []
    for doc, score in results:
        number = doc.metadata.get("number")
        if number == exclude_number:
            continue
        entry = {"number": number, "title": doc.page_content.split("\n", 1)[0], "score": score}
        if score > 0.85:
            duplicates.append(entry)
        elif score > 0.65:
            related.append(entry)

    return {"duplicates": duplicates, "related": related}
