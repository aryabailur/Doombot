import type {
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
  RepoGraphResponse,
  AskRequest,
  AskResponse,
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

export function getRepoGraph(owner: string, repo: string): Promise<RepoGraphResponse> {
  return request(`/api/repos/${owner}/${repo}/graph`);
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

export function askRepoGuardian(req: AskRequest): Promise<AskResponse> {
  return request("/api/ask", { method: "POST", body: JSON.stringify(req) });
}
