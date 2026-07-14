from agents.orchestrator import app
from rag.embedder import embeder


if __name__ == "__main__":
    repo_name = input("Enter repo name (owner/repo): ")
    pr_number = int(input("Enter PR number: "))

    initial_state={
    "repo_name":repo_name,
    "pr_number":pr_number,
    "pr_metadata":{},
    "diff_files":[],
    "review_metadata":[],
    "test_metadata":[],
    "summary_metadata":""
     }
    embeder(repo_name)
    result=app.invoke(initial_state)
    print(result["summary_metadata"])
