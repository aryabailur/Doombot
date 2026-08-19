from langchain_groq import ChatGroq
from agents.state import GraphState
from langchain_core.messages import (SystemMessage,HumanMessage)
from dotenv import load_dotenv
load_dotenv()
llm = ChatGroq(model="openai/gpt-oss-120b")

def test_writer_node(state:GraphState):
    review_metadata=state["review_metadata"]
    result = llm.invoke([
    SystemMessage(
        content="""You are a code review assistant specializing in test engineering.
        Given a list of code review findings, generate concrete, targeted test cases for each one.

For each finding, output:
- Finding ID / summary (match the original)
- Test case name (descriptive, snake_case)
- Test type (unit / integration / edge case)
- Preconditions
- Steps / input
- Expected result

Be specific. Avoid generic tests — each test should fail if and only if the finding is present."""
    ),
    HumanMessage(
        content=f"Generate test cases for the following findings:\n\n{review_metadata}"
    )
])
    return {"test_metadata":result.content}