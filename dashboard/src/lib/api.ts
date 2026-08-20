import type {
  RepoSummary,
  HealthResponse,
  InvestigationSummary,
  InvestigationDetail,
  Escalation,
  CreateInvestigationRequest,
  FeedbackRequest,
  BriefResponse,
  CodeGraphResponse,
  IndexJobResponse,
  IssueGraphResponse,
} from "./types";
import {
  mockRepos,
  mockHealth,
  mockInvestigations,
  mockInvestigationDetail,
  mockEscalations,
  mockBrief,
  mockCodeGraph,
  mockIssueGraph,
} from "./mocks";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";
const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === "true";

/**
 * WebSocket URL, derived from API_BASE rather than hardcoded.
 *
 * These must agree: the socket and the REST calls are served by the same
 * FastAPI app. Two independent literals meant setting VITE_API_BASE moved
 * REST to the new host while the socket silently kept dialling
 * localhost:8000 -- live streaming broke while every panel still loaded, so
 * the failure looked like "the agent stopped emitting steps" rather than a
 * misconfiguration.
 */
export const WS_URL = `${API_BASE.replace(/^http/, "ws")}/ws`;

export class ApiError extends Error {
  status: number;
  body: string;

  constructor(status: number, body: string) {
    // FastAPI wraps every error as {"detail": "..."}, so the raw body shown to
    // a user reads as `{"detail":"GitHub API quota exhausted..."}`. The message
    // inside is written to be read; the JSON around it is not.
    super(ApiError.readable(body));
    this.status = status;
    this.body = body;
  }

  private static readable(body: string): string {
    try {
      const parsed = JSON.parse(body) as { detail?: unknown };
      if (typeof parsed.detail === "string" && parsed.detail) {
        return parsed.detail;
      }
    } catch {
      // Not JSON: the raw text is the best available message.
    }
    return body;
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

/**
 * Investigate a repository's open issues (bounded).
 *
 * The dashboard could select a repository but had no way to make the agent
 * look at it, so an added repo was simply never analysed.
 */
/**
 * The full add-a-repository pipeline: connect, embed, select, investigate.
 *
 * Narrates each stage over the WebSocket. Prefer this over `scanRepository`
 * when adding a repository, since embedding is the slowest stage and the one
 * the user most needs to see happening.
 */
export function onboardRepository(
  owner: string,
  repo: string,
  limit = 5,
): Promise<{ repo_name: string; status: string; limit: number }> {
  return request(`/api/repos/${owner}/${repo}/onboard?limit=${limit}`, {
    method: "POST",
  });
}

export function scanRepository(
  owner: string,
  repo: string,
  limit = 5,
): Promise<{ repo_name: string; status: string; limit: number }> {
  return request(`/api/repos/${owner}/${repo}/scan?limit=${limit}`, {
    method: "POST",
  });
}

/** Optionally scoped to one repository; omit to list every repo's work. */
export function listInvestigations(
  repoName?: string,
): Promise<InvestigationSummary[]> {
  if (USE_MOCKS) return delay().then(() => mockInvestigations);
  const query = repoName ? `?repo_name=${encodeURIComponent(repoName)}` : "";
  return request(`/api/investigations${query}`);
}

export function getInvestigation(id: string): Promise<InvestigationDetail> {
  if (USE_MOCKS) return delay().then(() => mockInvestigationDetail(id));
  return request(`/api/investigations/${id}`);
}

export function listEscalations(repoName?: string): Promise<Escalation[]> {
  if (USE_MOCKS) return delay().then(() => mockEscalations);
  const query = repoName ? `?repo_name=${encodeURIComponent(repoName)}` : "";
  return request(`/api/escalations${query}`);
}

export function postFeedback(req: FeedbackRequest): Promise<{ ok: boolean }> {
  if (USE_MOCKS) return delay().then(() => ({ ok: true }));
  return request("/api/feedback", { method: "POST", body: JSON.stringify(req) });
}

export function getBrief(owner: string, repo: string): Promise<BriefResponse> {
  if (USE_MOCKS) return delay().then(() => mockBrief);
  return request(`/api/brief/${owner}/${repo}`);
}

export function getIssueGraph(
  owner: string,
  repo: string,
): Promise<IssueGraphResponse> {
  if (USE_MOCKS) return delay().then(() => mockIssueGraph);
  return request(`/api/repos/${owner}/${repo}/graph`);
}

export function getCodeGraph(
  owner: string,
  repo: string,
  changedPaths: string[] = [],
): Promise<CodeGraphResponse> {
  if (USE_MOCKS) return delay().then(() => mockCodeGraph);
  const params = new URLSearchParams();
  for (const path of changedPaths) params.append("changed_path", path);
  const encoded = params.toString();
  const query = encoded ? `?${encoded}` : "";
  return request(`/api/repos/${owner}/${repo}/code-graph${query}`);
}
