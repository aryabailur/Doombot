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

// ---------------------------------------------------------------------------
// F15 graphs. Hand-mirrored from api/schemas.py, like everything else in this
// file -- there is no codegen, so these must be kept in step by hand.
// ---------------------------------------------------------------------------

export type IssueGraphCategory =
  | "security"
  | "duplicate"
  | "stale"
  | "resolved"
  | "open";

export type IssueGraphLinkKind =
  | "duplicate"
  | "similar"
  | "reference"
  | "metadata";

export interface IssueGraphNodeApi {
  id: string;
  number: number;
  title: string;
  category: IssueGraphCategory;
  state: string;
  labels: string[];
  engagement: number;
  escalated: boolean;
}

export interface IssueGraphLinkApi {
  source: string;
  target: string;
  kind: IssueGraphLinkKind;
  score: number;
  /** Why these two are connected -- rendered verbatim when a link is clicked. */
  why: string;
}

export interface IssueGraphResponseApi {
  nodes: IssueGraphNodeApi[];
  links: IssueGraphLinkApi[];
  stats: Record<string, unknown>;
}

export type CodeGraphEdgeType = "calls" | "renders" | "http_calls";

export interface CodeGraphNodeApi {
  id: string;
  qualname: string;
  symbol_name: string;
  file_path: string;
  kind: string;
  runtime: string;
  language: string;
  start_line: number;
  end_line: number;
  cluster_label: string;
  in_degree: number;
  out_degree: number;
  hub_score: number;
  x2d: number;
  y2d: number;
  x3d: number;
  y3d: number;
  z3d: number;
  impact_status: "changed" | "ripple" | "unaffected";
  impact_distance: number | null;
}

export interface CodeGraphLinkApi {
  source: string;
  target: string;
  edge_type: CodeGraphEdgeType;
  why: string;
}

export interface CodeGraphResponseApi {
  repository: string;
  nodes: CodeGraphNodeApi[];
  links: CodeGraphLinkApi[];
  stats: {
    node_count: number;
    link_count: number;
    cluster_count: number;
    clusters: string[];
    languages: string[];
    attribution: string;
  };
  impact: Record<string, unknown>;
  /**
   * Every source file the build read, including files that parsed to zero
   * symbols. The explorer's file tree is built from this rather than from node
   * paths, so a file with no symbols is still browsable.
   */
  files: string[];
}

/** One file's contents, read on demand for the explorer's code pane. */
export interface SourceFileApi {
  path: string;
  content: string;
  lines: number;
  language: string;
  truncated: boolean;
}
