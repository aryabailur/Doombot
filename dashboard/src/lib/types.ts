// Hand-mirrored from api/schemas.py. Field names and casing are literal —
// do not translate to camelCase, the wire format is snake_case.

export type StepStatus = "running" | "done" | "error";

export interface Evidence {
  type: string;
  ref: string;
  score: number;
  snippet: string;
}

export interface StepRecord {
  step_id: string;
  investigation_id: string;
  seq: number;
  name: string;
  title: string;
  status: StepStatus;
  input_summary: string;
  output_summary: string;
  evidence: Evidence[];
  duration_ms: number;
  started_at: string;
  ended_at: string | null;
}

export type InvestigationKind = "issue" | "pr";

export interface InvestigationSummary {
  investigation_id: string;
  repo_name: string;
  kind: InvestigationKind;
  number: number;
  title: string;
  status: string;
  decision: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface InvestigationDetail extends InvestigationSummary {
  steps: StepRecord[];
  decision_reason: string | null;
  confidence: number | null;
  impact_score: number | null;
}

export interface Escalation {
  investigation_id: string;
  reason: string;
  severity: string;
  number: number;
  title: string;
  created_at: string;
}

export interface HealthBreakdown {
  security: number;
  staleness: number;
  duplication: number;
  responsiveness: number;
}

export interface HealthPoint {
  ts: string;
  score: number;
}

export interface HealthResponse {
  score: number;
  breakdown: HealthBreakdown;
  history: HealthPoint[];
}

export interface RepoSummary {
  repo_name: string;
  health_score: number;
  open_investigations: number;
  last_scan: string | null;
}

export interface CreateInvestigationRequest {
  repo_name: string;
  kind: InvestigationKind;
  number: number;
}

export interface FeedbackRequest {
  investigation_id: string;
  step_id?: string | null;
  verdict: "up" | "down";
  note?: string | null;
}

export interface BriefResponse {
  markdown: string;
  generated_at: string;
}

export interface IndexJobResponse {
  job_id: string;
  status: string;
}

export interface WsEnvelope<T = unknown> {
  type: "step.started" | "step.completed" | "investigation.completed" | "activity";
  data: T;
}

export interface InvestigationCompletedPayload {
  investigation_id: string;
  decision: string;
  health_delta: number;
}

export interface ActivityPayload {
  ts: string;
  repo_name: string;
  message: string;
  severity: string;
}
