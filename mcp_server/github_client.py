from github import Github
from dotenv import load_dotenv
import os
load_dotenv()
github_token=os.getenv("GITHUB_TOKEN")

_client: Github | None = None

def _get_client() -> Github:
    global _client
    if _client is None:
        _client = Github(github_token)
    return _client

def git_initialization(repo_name,pr_number):
    g=_get_client()
    repo=g.get_repo(repo_name)
    pr=repo.get_pull(pr_number)
    return pr

def get_pr_files(repo_name:str,pr_number:int):

    pr=git_initialization(repo_name,pr_number)
    files=pr.get_files()
    files_dict={}
    files_list=[]
    for file in files:
        files_dict={
            "name":file.filename,
            "differences":file.patch
        }
        files_list.append(files_dict)
    return files_list

def get_pr_details(repo_name,pr_number):
    pr=git_initialization(repo_name,pr_number)
    pr_info={
        "title":pr.title,
        "body":pr.body,
        "state":pr.state,
        "username":pr.user.login
    }
    return pr_info

def get_file_content(repo_name,file_path):
    g=_get_client()
    repo=g.get_repo(repo_name)
    file=repo.get_contents(file_path)
    try:
        return file.decoded_content.decode("utf-8")
    except UnicodeDecodeError:
        return ""

def post_review_comment(repo_name,pr_number,comment):
    pr=git_initialization(repo_name,pr_number)
    comment=pr.create_issue_comment(comment)
    return comment.body

SKIP_EXTENSIONS = ['.png', '.jpg', '.gif', '.svg', '.ico', '.pdf', '.zip', '.node']
SKIP_DIRS = ['node_modules', '.git', 'venv', '__pycache__', 'dist', 'build']

def get_repo_files(repo_name):
    g = _get_client()
    repo = g.get_repo(repo_name)
    content = list(repo.get_contents(""))
    files = []
    while content:
        file = content.pop(0)
        if any(skip in file.path for skip in SKIP_DIRS):
            continue
        if file.type == "dir":
            content.extend(repo.get_contents(file.path))
        else:
            if not any(file.path.endswith(ext) for ext in SKIP_EXTENSIONS):
                files.append(file.path)
    return files


def _issue_dict(issue, participants: int | None = None) -> dict:
    """Single source of truth for the issue dict shape shared by get_issue
    and get_issues. If `participants` is not given, it is computed exactly
    as the distinct count of the issue author plus all comment authors
    (an extra API call to list comments)."""
    if participants is None:
        authors = {issue.user.login}
        for c in issue.get_comments():
            authors.add(c.user.login)
        participants = len(authors)

    try:
        reactions = issue.get_reactions().totalCount
    except Exception:
        reactions = getattr(issue, "reactions", {}).get("total_count", 0) if isinstance(getattr(issue, "reactions", None), dict) else 0

    return {
        "number": issue.number,
        "title": issue.title,
        "body": issue.body or "",
        "state": issue.state,
        "author": issue.user.login,
        "labels": [label.name for label in issue.labels],
        "reactions": reactions,
        "comments": issue.comments,
        "participants": participants,
        "created_at": issue.created_at.isoformat(),
        "updated_at": issue.updated_at.isoformat(),
    }


def get_issue(repo_name: str, issue_number: int) -> dict:
    """Fetch one issue and return a normalized dict:
    {number, title, body, state, author, labels, reactions, comments,
     participants, created_at, updated_at}.
    `participants` is the exact count of distinct users = the issue author
    plus every distinct comment author (requires listing comments)."""
    g = _get_client()
    repo = g.get_repo(repo_name)
    issue = repo.get_issue(issue_number)
    return _issue_dict(issue)


def get_issues(repo_name: str, state: str = "open", limit: int = 100) -> list[dict]:
    """List up to `limit` issues for repo_name filtered by state
    ('open'/'closed'/'all'). Same per-issue dict shape as get_issue.

    PyGithub's repo.get_issues() returns pull requests as well as issues
    (GitHub's REST API treats every PR as an issue), so anything with a
    non-None `pull_request` attribute is filtered out here.

    Note (participants approximation): computing exact distinct participant
    counts requires one extra API call per issue (to list its comments),
    which does not scale across a bulk listing and risks exhausting the
    rate limit. For this bulk path, `participants` is therefore approximated
    as `1 + issue.comments` (issue author + one per comment, not
    deduplicated by author) rather than the exact distinct-author count
    that get_issue computes.
    """
    g = _get_client()
    repo = g.get_repo(repo_name)
    results = []
    for issue in repo.get_issues(state=state):
        if issue.pull_request is not None:
            continue
        results.append(_issue_dict(issue, participants=1 + issue.comments))
        if len(results) >= limit:
            break
    return results


def post_issue_comment(repo_name: str, issue_number: int, comment: str) -> str:
    """Post a comment on the issue. Return the created comment's body."""
    g = _get_client()
    repo = g.get_repo(repo_name)
    issue = repo.get_issue(issue_number)
    created = issue.create_comment(comment)
    return created.body


def add_labels(repo_name: str, issue_number: int, labels: list[str]) -> list[str]:
    """Add the given labels to the issue (does not remove existing labels).
    Return the issue's full label name list after the add."""
    g = _get_client()
    repo = g.get_repo(repo_name)
    issue = repo.get_issue(issue_number)
    issue.add_to_labels(*labels)
    issue = repo.get_issue(issue_number)
    return [label.name for label in issue.labels]


def get_issue_comments(repo_name: str, issue_number: int) -> list[dict]:
    """Return an issue's comments as [{"author": str, "body": str}].

    Used by the decider to detect its own prior comment before posting, so a
    re-run does not duplicate it.
    """
    issue = _get_client().get_repo(repo_name).get_issue(issue_number)
    return [
        {"author": c.user.login if c.user else "", "body": c.body or ""}
        for c in issue.get_comments()
    ]
