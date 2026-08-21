// Hand-mirrored from api/schemas.py. Field names and casing are literal —
// do not translate to camelCase, the wire format is snake_case.

export type StepStatus = "running" | "done" | "error";

/**
 * Evidence backing one investigation step.
 *
 * `type` is a closed union, not a bare string. api/CLAUDE.md's example
 * comment lists "duplicate", "security", "file", but what the agent actually
 * emits is the set in agents/CLAUDE.md 3.6 -- and EvidenceCard indexes a map
 * keyed on exactly these four, so a bare `string` fails to compile there.
 *
 * `score` is nullable: rule-type evidence (a matched security keyword, a
 * threshold note) has no meaningful score, and the backend sends null rather
 * than a misleading 0.
 */
export type EvidenceType = "issue" | "pr" | "file" | "rule";

export interface Evidence {
  type: EvidenceType;
  ref: string;
  score: number | null;
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

export type ActionStatus =
  | "proposed"
  | "approved"
  | "rejected"
  | "executing"
  | "verified"
  | "failed";

export interface ProposedAction {
  id: string;
  investigation_id: string;
  repo_name: string;
  issue_number: number;
  action: string;
  comment: string | null;
  labels: string[];
  status: ActionStatus;
  decided_by: string | null;
  decision_note: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  decided_at: string | null;
  executed_at: string | null;
}

export interface InvestigationDetail extends InvestigationSummary {
  steps: StepRecord[];
  decision_reason: string | null;
  confidence: number | null;
  impact_score: number | null;
  proposed_action: ProposedAction | null;
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
  /**
   * False when the repository has no issues to measure. Three of the four
   * sub-scores return 100 for an empty backlog, so an unread repo would
   * otherwise report a confident 100/100.
   */
  measured: boolean;
  issue_count: number;
  /** True when the issues could not be read (rate limit, network, access). */
  unreadable: boolean;
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

export interface ActionDecisionRequest {
  approved: boolean;
  decided_by: string;
  note?: string | null;
}

export type PolicyGuidance = "observing" | "caution" | "mixed" | "aligned";

export interface ActionPolicyProfile {
  action: string;
  samples: number;
  approvals: number;
  rejections: number;
  approval_rate: number;
  guidance: PolicyGuidance;
}

export interface LabelPolicyProfile {
  label: string;
  samples: number;
  approvals: number;
  rejections: number;
  approval_rate: number;
  guidance: PolicyGuidance;
}

export interface RepositoryPolicy {
  repo_name: string;
  mode: "observing" | "learned";
  minimum_samples: number;
  total_decisions: number;
  approvals: number;
  rejections: number;
  approval_rate: number | null;
  actions: ActionPolicyProfile[];
  labels: LabelPolicyProfile[];
  learned_rules: string[];
  updated_at: string | null;
}

export interface BriefResponse {
  markdown: string;
  generated_at: string;
}

export interface IndexJobResponse {
  job_id: string;
  status: string;
}

export interface FixReceipt {
  command: string[];
  exit_code: number;
  duration_ms: number;
  stdout: string;
  stderr: string;
  containerized: boolean;
  network_disabled: boolean;
  image: string;
  image_digest: string;
}

export interface FixRun {
  id: string;
  investigation_id: string;
  repo_name: string;
  issue_number: number;
  status: "queued" | "preparing" | "generating" | "verifying" | "proposed" | "failed" | "approved" | "rejected" | "publishing" | "published";
  base_sha: string | null;
  summary: string | null;
  patch_diff: string | null;
  commands: string[][];
  receipts: FixReceipt[];
  error: string | null;
  decided_by: string | null;
  decision_note: string | null;
  created_at: string;
  updated_at: string;
  decided_at: string | null;
  published_at: string | null;
}

export interface CreateFixRunRequest {
  investigation_id: string;
}

export interface FixDecisionRequest {
  approved: boolean;
  decided_by: string;
  note?: string;
}

export interface WsEnvelope<T = unknown> {
  type:
    | "step.started"
    | "step.completed"
    | "investigation.completed"
    | "activity"
    | "pipeline";
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

export interface IssueGraphNode {
  id: string;
  number: number;
  title: string;
  category: IssueGraphCategory;
  state: string;
  labels: string[];
  engagement: number;
  escalated: boolean;
}

export interface IssueGraphLink {
  source: string;
  target: string;
  kind: IssueGraphLinkKind;
  score: number;
  why: string;
}

export interface IssueGraphResponse {
  nodes: IssueGraphNode[];
  links: IssueGraphLink[];
  stats: Record<string, unknown>;
}

export type CodeGraphEdgeType = "calls" | "renders" | "http_calls";
export type CodeGraphImpactStatus = "changed" | "ripple" | "unaffected";

export interface CodeGraphNode {
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
  impact_status: CodeGraphImpactStatus;
  impact_distance: number | null;
}

export interface CodeGraphLink {
  source: string;
  target: string;
  edge_type: CodeGraphEdgeType;
  why: string;
}

export interface CodeGraphImpactedUnit {
  qualname: string;
  distance: number;
  edge_type: CodeGraphEdgeType;
}

export interface CodeGraphClusterImpact {
  cluster: string;
  impact_score: number;
  changed_count: number;
  ripple_count: number;
  total_count: number;
}

export interface CodeGraphImpact {
  risk_level: "low" | "medium" | "high" | "critical";
  changed_units: string[];
  impacted_units: CodeGraphImpactedUnit[];
  cluster_impact: CodeGraphClusterImpact[];
  suggested_labels: string[];
}

export interface CodeGraphStats {
  node_count: number;
  link_count: number;
  cluster_count: number;
  clusters: string[];
  languages: string[];
  attribution: string;
}

export interface CodeGraphResponse {
  repository: string;
  nodes: CodeGraphNode[];
  links: CodeGraphLink[];
  stats: CodeGraphStats;
  impact: CodeGraphImpact;
}
