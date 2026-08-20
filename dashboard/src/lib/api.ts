import type {
  GraphLink,
  GraphNode,
  GraphStats,
  RepoSummary,
  HealthResponse,
  InvestigationSummary,
  InvestigationDetail,
  Escalation,
  CreateInvestigationRequest,
  FeedbackRequest,
  BriefResponse,
  IndexJobResponse,
} from "./types";
import {
  mockRepos,
  mockHealth,
  mockInvestigations,
  mockInvestigationDetail,
  mockEscalations,
  mockBrief,
} from "./mocks";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";
const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === "true";

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

const delay = (ms = 250) => new Promise((r) => setTimeout(r, ms));

export function getHealth(): Promise<{ status: string }> {
  if (USE_MOCKS) return delay().then(() => ({ status: "ok" }));
  return request("/api/health");
}

export function getRepos(): Promise<RepoSummary[]> {
  if (USE_MOCKS) return delay().then(() => mockRepos);
  return request("/api/repos");
}

export function indexRepo(owner: string, repo: string): Promise<IndexJobResponse> {
  if (USE_MOCKS) return delay().then(() => ({ job_id: "mock-job", status: "queued" }));
  return request(`/api/repos/${owner}/${repo}/index`, { method: "POST" });
}

export function getRepoHealth(owner: string, repo: string): Promise<HealthResponse> {
  if (USE_MOCKS) return delay().then(() => mockHealth);
  return request(`/api/repos/${owner}/${repo}/health`);
}

export function createInvestigation(
  req: CreateInvestigationRequest
): Promise<{ investigation_id: string }> {
  if (USE_MOCKS) return delay().then(() => ({ investigation_id: "mock-inv-" + Date.now() }));
  return request("/api/investigations", { method: "POST", body: JSON.stringify(req) });
}

export function listInvestigations(): Promise<InvestigationSummary[]> {
  if (USE_MOCKS) return delay().then(() => mockInvestigations);
  return request("/api/investigations");
}

export function getInvestigation(id: string): Promise<InvestigationDetail> {
  if (USE_MOCKS) return delay().then(() => mockInvestigationDetail(id));
  return request(`/api/investigations/${id}`);
}

export function listEscalations(): Promise<Escalation[]> {
  if (USE_MOCKS) return delay().then(() => mockEscalations);
  return request("/api/escalations");
}

export function postFeedback(req: FeedbackRequest): Promise<{ ok: boolean }> {
  if (USE_MOCKS) return delay().then(() => ({ ok: true }));
  return request("/api/feedback", { method: "POST", body: JSON.stringify(req) });
}

/**
 * Issue relationship graph (F15).
 *
 * Not in Stream A's original client because the endpoint was added later.
 * Returns the same {nodes, links} shape `rag.graph.build_graph` produces, so
 * IssueGraph consumes it without a mapping layer.
 */
export function getRepoGraph(
  owner: string,
  repo: string,
): Promise<{ nodes: GraphNode[]; links: GraphLink[]; stats: GraphStats }> {
  if (USE_MOCKS) {
    return delay().then(() => ({ nodes: [], links: [], stats: {} as GraphStats }));
  }
  return request(`/api/repos/${owner}/${repo}/graph`);
}

export function getBrief(owner: string, repo: string): Promise<BriefResponse> {
  if (USE_MOCKS) return delay().then(() => mockBrief);
  return request(`/api/brief/${owner}/${repo}`);
}
