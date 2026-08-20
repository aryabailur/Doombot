from github import Github
from urllib3.util import Retry
from dotenv import load_dotenv
import logging
import os

logger = logging.getLogger(__name__)
load_dotenv()
github_token=os.getenv("GITHUB_TOKEN")

_client: Github | None = None

def _get_client() -> Github:
    """The shared PyGithub client, configured to fail fast when throttled.

    PyGithub's default `GithubRetry` *sleeps inside the call* when GitHub
    returns 403 for a rate limit -- it waits for the quota window to reset.
    Observed here: "Setting next backoff to 1524.97s", a 25-minute sleep with
    the request still open. That is why adding a repository buffered forever
    with nothing in the API log: uvicorn logs on completion, and the request
    never completed.

    Waiting is arguably correct for a batch job and completely wrong for a
    request a person is watching. A plain urllib3 retry keeps the useful part
    -- a couple of attempts at transient 5xx -- without the rate-limit sleep,
    so an exhausted quota raises RateLimitExceededException in well under a
    second and the caller can say so. Measured: 0.49s to raise, versus a
    22-minute hang.

    `per_page=100` is the other half. The default of 30 triples the request
    count for the same data, and request count is exactly what exhausts the
    5000/hour quota -- indexing a 200-issue backlog costs 7 pages instead of
    2. Cheaper is the best defence against hitting the limit at all.
    """
    global _client
    if _client is None:
        _client = Github(
            github_token,
            retry=Retry(
                total=2,
                backoff_factor=0.4,
                status_forcelist=[500, 502, 503, 504],
                allowed_methods=None,
            ),
            per_page=100,
            timeout=20,
        )
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


def _reaction_count(issue, bulk: bool = False) -> int:
    """Total reactions on an issue, preferring the embedded count.

    `raw_data` is whatever the API already returned for this issue, so
    reading it costs nothing. Only fall back to the dedicated endpoint when
    the field is genuinely absent and an extra call is affordable.
    """
    # `_rawData`, not the public `raw_data`. PyGithub's property *completes*
    # a lazily-loaded object, firing one full GET per issue -- measured at
    # 68.1s across 100 search results versus 3.7s reading the already-loaded
    # attribute. Search results arrive with reactions embedded, so the fetch
    # buys nothing. Private attribute access is the tradeoff, hence the
    # getattr guard rather than touching it directly.
    raw = getattr(issue, "_rawData", None)
    if isinstance(raw, dict):
        embedded = raw.get("reactions")
        if isinstance(embedded, dict) and "total_count" in embedded:
            try:
                return int(embedded["total_count"])
            except (TypeError, ValueError):
                pass

    if bulk:
        # Never spend a request per issue on a bulk listing.
        return 0

    try:
        return issue.get_reactions().totalCount
    except Exception:
        return 0


def _issue_dict(
    issue, participants: int | None = None, bulk: bool = False
) -> dict:
    """Single source of truth for the issue dict shape shared by get_issue
    and get_issues. If `participants` is not given, it is computed exactly
    as the distinct count of the issue author plus all comment authors
    (an extra API call to list comments).

    `bulk=True` forbids any per-issue API call. The listing endpoint already
    embeds a `reactions.total_count` in each issue payload, so calling
    `get_reactions()` spends a whole round trip to learn something already in
    hand. Sequentially, over a 100-issue listing, that measured 22.9s for ten
    issues -- about 229s for a hundred, which is longer than any caller will
    wait: it made /api/repos/{owner}/{repo}/health hang outright on a large
    repository, so selecting a newly added repo appeared to do nothing.
    """
    if participants is None:
        authors = {issue.user.login}
        for c in issue.get_comments():
            authors.add(c.user.login)
        participants = len(authors)

    reactions = _reaction_count(issue, bulk=bulk)

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

    # Prefer the search API, which filters pull requests server-side.
    #
    # repo.get_issues() returns PRs interleaved with issues and they have to be
    # discarded client-side. On a PR-heavy repository that is brutal: measured
    # on fastapi/fastapi, 118 of 120 listing entries were pull requests, so
    # collecting 100 real issues meant paging through roughly 6000 entries --
    # 136s, which made the health endpoint hang and a freshly added repo look
    # like it did nothing. The same 100 issues come back from search in 4.0s.
    #
    # `repo.full_name` rather than the caller's string: a renamed or
    # transferred repository still resolves via get_repo, but the search index
    # only knows the canonical name and returns 422 for the old one.
    try:
        query = f"repo:{repo.full_name} is:issue"
        if state in ("open", "closed"):
            query += f" is:{state}"
        results = []
        for issue in g.search_issues(query, sort="created", order="desc"):
            results.append(
                _issue_dict(issue, participants=1 + issue.comments, bulk=True)
            )
            if len(results) >= limit:
                break
        return results
    except Exception:
        # Search is rate-limited separately (30/min) and can fail on its own,
        # so the listing path stays as a fallback rather than being deleted.
        logger.warning(
            "get_issues: search unavailable for %s, falling back to listing",
            repo_name,
            exc_info=True,
        )

    results = []
    for issue in repo.get_issues(state=state):
        if issue.pull_request is not None:
            continue
        results.append(
            _issue_dict(issue, participants=1 + issue.comments, bulk=True)
        )
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
