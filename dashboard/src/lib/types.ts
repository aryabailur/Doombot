// Hand-mirrored from api/schemas.py. Field names/casing are literal.

export interface Evidence {
  type: string;
  ref: string;
  score: number;
  snippet: string;
}

export type StepStatus = "running" | "done" | "error";

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
  tool_calls: string[];
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

export interface EscalationApi {
  investigation_id: string;
  reason: string;
  severity: string;
  number: number;
  title: string;
  created_at: string;
}

export interface HealthBreakdownApi {
  security: number;
  staleness: number;
  duplication: number;
  responsiveness: number;
}

export interface HealthPointApi {
  ts: string;
  score: number;
}

export type HealthTrend = "improving" | "stable" | "declining";

export interface HealthForecastApi {
  horizon_days: number;
  projected_score: number;
  projected_backlog: number | null;
  confidence: number;
  trend: HealthTrend;
  reason: string;
}

export interface HealthResponseApi {
  score: number;
  breakdown: HealthBreakdownApi;
  history: HealthPointApi[];
  forecast: HealthForecastApi | null;
}

export interface RepoSummaryApi {
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

export interface BriefResponseApi {
  markdown: string;
  generated_at: string;
}

export interface IndexJobResponse {
  job_id: string;
  status: string;
}

export interface WsEnvelope<T = unknown> {
  type:
    | "step.started"
    | "step.completed"
    | "investigation.completed"
    | "activity"
    | "action.approved";
  data: T;
}

export interface MemoryQueryResult {
  item_id: string;
  type: string;
  title: string;
  score: number;
  reason: string;
  number: number | null;
  url: string | null;
}

export interface MemoryQueryResponseApi {
  query: string;
  results: MemoryQueryResult[];
}

export interface ActivityEventApi {
  ts: string;
  investigation_id: string;
  repo_name: string;
  kind: string;
  message: string;
  severity: string;
  number: number | null;
}

export interface ActivityPageApi {
  events: ActivityEventApi[];
  next_cursor: string | null;
}

export type SuggestedActionKind = "add_labels" | "post_comment";
export type SuggestedActionStatus = "pending" | "approved" | "rejected";

export interface SuggestedActionApi {
  action_id: string;
  investigation_id: string;
  repo_name: string;
  number: number;
  kind: SuggestedActionKind;
  payload: { labels?: string[]; comment?: string };
  reason: string;
  confidence: number;
  status: SuggestedActionStatus;
  created_at: string;
}

export interface ApproveActionResponseApi {
  ok: boolean;
  result: string;
}

// Mirrors new GraphNode/GraphLink/RepoGraphResponse models in api/schemas.py (additive, non-breaking).
export interface GraphNode {
  id: string;
  name: string;
  type: "Repository" | "Directory" | "File" | "Issue" | "PullRequest" | "Decision";
  file: string | null;
  val: number;
}

export interface GraphLink {
  source: string;
  target: string;
  type: "CONTAINS" | "EVIDENCE" | "DECIDED";
  score: number | null;
}

export interface RepoGraphResponse {
  nodes: GraphNode[];
  links: GraphLink[];
  metadata: Record<string, unknown>;
}
