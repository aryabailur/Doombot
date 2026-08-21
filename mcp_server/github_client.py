from github import Github
from github.GithubRetry import GithubRetry
from github.GithubException import RateLimitExceededException, GithubException
from dotenv import load_dotenv
import os
load_dotenv()
github_token=os.getenv("GITHUB_TOKEN")

_client: Github | None = None


def _get_client() -> Github:
    global _client
    if _client is None:
        # PyGithub's default retry (GithubRetry(total=10, ...)) silently
        # backs off for minutes on a 403/rate-limit response before
        # surfacing anything — indistinguishable from a hung/deadlocked
        # call until you inspect response headers directly. Disable it so
        # a real rate limit raises immediately (per mcp_server/CLAUDE.md
        # §7: "do not silently retry in a tight loop — surface the error").
        _client = Github(github_token, retry=GithubRetry(total=0))
    return _client


class GithubRateLimited(RuntimeError):
    """Raised in place of a raw RateLimitExceededException so every caller
    up the stack (agents/triage/*.py, api/routes_investigations.py) gets a
    readable str(e) instead of a urllib3 connection-pool dump. Per
    mcp_server/CLAUDE.md §7: surface the error, never retry silently."""


def _reraise_readable(exc: Exception, action: str):
    """Wrap a real PyGithub failure with a human-readable message, without
    hiding which repo/action failed or why. Never swallows the exception —
    always re-raises, just with a clearer message attached."""
    if isinstance(exc, RateLimitExceededException):
        reset = getattr(exc, "headers", {}).get("x-ratelimit-reset") if getattr(exc, "headers", None) else None
        when = f" Resets at unix time {reset}." if reset else ""
        raise GithubRateLimited(f"GitHub API rate limit exceeded while {action}.{when}") from exc
    if isinstance(exc, GithubException):
        raise GithubException(exc.status, f"GitHub API error while {action}: {exc.data}", exc.headers) from exc
    raise RuntimeError(f"Unexpected error while {action}: {exc}") from exc


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


def get_issue(repo_name: str, issue_number: int) -> dict:
    try:
        g = _get_client()
        repo = g.get_repo(repo_name)
        issue = repo.get_issue(issue_number)
        return {
            "number": issue.number,
            "title": issue.title,
            "body": issue.body or "",
            "state": issue.state,
            "username": issue.user.login if issue.user else None,
            "labels": [label.name for label in issue.labels],
        }
    except (RateLimitExceededException, GithubException) as e:
        _reraise_readable(e, f"fetching issue {repo_name}#{issue_number}")


def get_issues(repo_name: str, state: str = "open", limit: int = 30) -> list[dict]:
    try:
        g = _get_client()
        repo = g.get_repo(repo_name)
        issues = []
        for issue in repo.get_issues(state=state):
            if issue.pull_request is not None:
                continue
            issues.append(
                {
                    "number": issue.number,
                    "title": issue.title,
                    "body": issue.body or "",
                    "state": issue.state,
                    "username": issue.user.login if issue.user else None,
                    "labels": [label.name for label in issue.labels],
                }
            )
            if len(issues) >= limit:
                break
        return issues
    except (RateLimitExceededException, GithubException) as e:
        _reraise_readable(e, f"listing issues for {repo_name}")


def post_issue_comment(repo_name: str, issue_number: int, comment: str) -> str:
    try:
        g = _get_client()
        repo = g.get_repo(repo_name)
        issue = repo.get_issue(issue_number)
        created = issue.create_comment(comment)
        return created.body
    except (RateLimitExceededException, GithubException) as e:
        _reraise_readable(e, f"posting a comment on {repo_name}#{issue_number}")


def add_labels(repo_name: str, issue_number: int, labels: list[str]) -> list[str]:
    try:
        g = _get_client()
        repo = g.get_repo(repo_name)
        issue = repo.get_issue(issue_number)
        issue.add_to_labels(*labels)
        return [label.name for label in issue.labels]
    except (RateLimitExceededException, GithubException) as e:
        _reraise_readable(e, f"adding labels to {repo_name}#{issue_number}")

SKIP_EXTENSIONS = ['.png', '.jpg', '.gif', '.svg', '.ico', '.pdf', '.zip', '.node']
SKIP_DIRS = ['node_modules', '.git', 'venv', '__pycache__', 'dist', 'build']

def get_repo_files(repo_name):
    try:
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
    except (RateLimitExceededException, GithubException) as e:
        _reraise_readable(e, f"walking the file tree for {repo_name}")