import type {
  CodeGraphResponseApi,
  SourceFileApi,
  IssueGraphResponseApi,
  RepoSummaryApi,
  HealthResponseApi,
  InvestigationSummary,
  InvestigationDetail,
  EscalationApi,
  CreateInvestigationRequest,
  FeedbackRequest,
  BriefResponseApi,
  IndexJobResponse,
  MemoryQueryResponseApi,
  ActivityPageApi,
  SuggestedActionApi,
  ApproveActionResponseApi,
} from "./types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";

export class ApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(body);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.json();
}

export function getHealth(): Promise<{ status: string }> {
  return request("/api/health");
}

export function getRepos(): Promise<RepoSummaryApi[]> {
  return request("/api/repos");
}

export function indexRepo(owner: string, repo: string): Promise<IndexJobResponse> {
  return request(`/api/repos/${owner}/${repo}/index`, { method: "POST" });
}

export function getRepoHealth(owner: string, repo: string): Promise<HealthResponseApi> {
  return request(`/api/repos/${owner}/${repo}/health`);
}

export function createInvestigation(
  req: CreateInvestigationRequest
): Promise<{ investigation_id: string }> {
  return request("/api/investigations", { method: "POST", body: JSON.stringify(req) });
}

export function listInvestigations(repoName?: string): Promise<InvestigationSummary[]> {
  const query = repoName ? `?repo_name=${encodeURIComponent(repoName)}` : "";
  return request(`/api/investigations${query}`);
}

export function getInvestigation(id: string): Promise<InvestigationDetail> {
  return request(`/api/investigations/${id}`);
}

export function listEscalations(repoName?: string): Promise<EscalationApi[]> {
  const query = repoName ? `?repo_name=${encodeURIComponent(repoName)}` : "";
  return request(`/api/escalations${query}`);
}

export function postFeedback(req: FeedbackRequest): Promise<{ ok: boolean }> {
  return request("/api/feedback", { method: "POST", body: JSON.stringify(req) });
}

export function getBrief(owner: string, repo: string): Promise<BriefResponseApi> {
  return request(`/api/brief/${owner}/${repo}`);
}

export function queryMemory(
  owner: string,
  repo: string,
  q: string,
  k?: number
): Promise<MemoryQueryResponseApi> {
  const params = new URLSearchParams({ q, ...(k ? { k: String(k) } : {}) });
  return request(`/api/repos/${owner}/${repo}/memory?${params.toString()}`);
}

export function getActivity(repoName?: string, limit?: number): Promise<ActivityPageApi> {
  const params = new URLSearchParams();
  if (repoName) params.set("repo_name", repoName);
  if (limit) params.set("limit", String(limit));
  const query = params.toString() ? `?${params.toString()}` : "";
  return request(`/api/activity${query}`);
}

export function listActions(
  repoName?: string,
  status: string | null = "pending"
): Promise<SuggestedActionApi[]> {
  const params = new URLSearchParams();
  if (repoName) params.set("repo_name", repoName);
  if (status !== undefined && status !== null) params.set("status", status);
  const query = params.toString() ? `?${params.toString()}` : "";
  return request(`/api/actions${query}`);
}

export function approveAction(actionId: string): Promise<ApproveActionResponseApi> {
  return request(`/api/actions/${actionId}/approve`, { method: "POST" });
}

export function rejectAction(actionId: string): Promise<ApproveActionResponseApi> {
  return request(`/api/actions/${actionId}/reject`, { method: "POST" });
}

/** Issue relationship graph (F15). Requires the repository to be indexed. */
export function getIssueGraph(
  owner: string,
  repo: string
): Promise<IssueGraphResponseApi> {
  return request(`/api/repos/${owner}/${repo}/graph`);
}

/**
 * Semantic code graph (F15).
 *
 * `changedPaths` is optional and drives the blast-radius overlay: pass the
 * files a pull request touches and each unit comes back marked changed,
 * rippled, or unaffected.
 */
export function getCodeGraph(
  owner: string,
  repo: string,
  changedPaths: string[] = []
): Promise<CodeGraphResponseApi> {
  const query = changedPaths
    .map((path) => `changed_path=${encodeURIComponent(path)}`)
    .join("&");
  return request(
    `/api/repos/${owner}/${repo}/code-graph${query ? `?${query}` : ""}`
  );
}

/**
 * One repository file, for the explorer's code pane.
 *
 * Fetched per click rather than bundled into the code graph: sixty files of
 * source would multiply that payload for content nobody reads until they open
 * a file. Cached server-side, so clicking back through a subsystem is free.
 */
export function getSourceFile(
  owner: string,
  repo: string,
  path: string
): Promise<SourceFileApi> {
  return request(
    `/api/repos/${owner}/${repo}/source?path=${encodeURIComponent(path)}`
  );
}
