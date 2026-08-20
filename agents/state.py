from typing import Annotated
from operator import add
from typing_extensions import TypedDict

class GraphState(TypedDict, total=False):
    # existing — PR review graph
    repo_name:str
    pr_number:int
    pr_metadata:dict
    diff_files:list[dict]
    review_metadata:Annotated[list[dict],add]
    test_metadata:str
    summary_metadata:str

    # new — issue triage graph
    investigation_id:str
    issue_number:int
    issue_metadata:dict
    duplicates:list[dict]
    security_findings:list[dict]
    impact_score:int
    labels:list[str]
    decision:dict
    chain:Annotated[list[dict],add]
