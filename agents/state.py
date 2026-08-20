from typing import Annotated
from operator import add
from typing_extensions import TypedDict

class GraphState(TypedDict):
    repo_name:str
    pr_number:int
    pr_metadata:dict
    diff_files:list[dict]
    review_metadata:Annotated[list[dict],add]
    test_metadata:str
    summary_metadata:str
