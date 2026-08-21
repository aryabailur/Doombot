// Maps real backend shapes (api/schemas.py, mirrored in types.ts) onto the
// UI's existing Investigation/AgentStep/EvidenceRef shapes (seed.ts) so
// components built against the demo data work unchanged against a live repo.
import type {
  InvestigationSummary,
  InvestigationDetail,
  StepRecord,
  Evidence,
  EscalationApi,
  HealthResponseApi,
} from "./types";
import type { Decision, EvidenceRef, AgentStep, Investigation } from "./seed";
import { getInvestigation, listInvestigations } from "./api";

// Real decision strings the agent actually produces (agents/triage/decider.py)
// mapped onto the 5-value UI union the components render.
const DECISION_MAP: Record<string, Decision> = {
  escalate: "escalate",
  close_as_duplicate: "duplicate",
  auto_comment: "silent",
  hold: "insufficient",
  followup: "followup",
  unknown: "insufficient",
  error: "insufficient",
};

export function apiDecisionToUi(decision: string | null): Decision {
  if (!decision) return "insufficient";
  return DECISION_MAP[decision] ?? "insufficient";
}

const EVIDENCE_KIND_MAP: Record<string, EvidenceRef["kind"]> = {
  issue: "issue",
  pr: "pr",
  duplicate: "issue",
  security: "decision",
  impact: "decision",
  label: "decision",
  decision: "decision",
  commit: "commit",
  file: "commit",
};

function toEvidenceRef(ev: Evidence): EvidenceRef {
  const kind = EVIDENCE_KIND_MAP[ev.type] ?? "issue";
  return {
    id: ev.ref,
    label: ev.snippet,
    kind,
    similarity: ev.type === "duplicate" || ev.type === "issue" ? ev.score : undefined,
    relevance: ev.type === "pr" ? ev.score : undefined,
    score: ev.score,
    rawType: ev.type,
  };
}

function toAgentStep(step: StepRecord): AgentStep {
  return {
    seq: step.seq,
    name: step.name,
    title: step.title,
    detail: step.output_summary || step.input_summary || "",
    sources: step.evidence.map(toEvidenceRef),
    status: step.status,
    ts: new Date(step.started_at).toLocaleTimeString(),
    toolCalls: step.tool_calls,
  };
}

function severityFromDecision(decision: string | null, confidence: number | null): Investigation["severity"] {
  if (decision === "escalate") {
    return (confidence ?? 0) >= 0.85 ? "critical" : "high";
  }
  if (decision === "hold" || decision === "unknown") return "medium";
  return "low";
}

export function summaryToInvestigation(summary: InvestigationSummary): Investigation {
  const decision = apiDecisionToUi(summary.decision);
  return {
    id: summary.investigation_id,
    number: summary.number,
    title: summary.title,
    kind: summary.kind,
    author: "",
    body: "",
    labels: [],
    createdAt: summary.created_at,
    decision,
    confidence: 0,
    reason: "",
    category: "",
    evidence: [],
    steps: [],
    needsAttention: decision === "escalate" || decision === "followup" || summary.status === "running",
    severity: severityFromDecision(summary.decision, null),
  };
}

export function detailToInvestigation(detail: InvestigationDetail): Investigation {
  const decision = apiDecisionToUi(detail.decision);
  const lastStep = detail.steps[detail.steps.length - 1];
  const rawEvidence = detail.steps.flatMap((s) => s.evidence);
  const allEvidence = rawEvidence.map(toEvidenceRef);

  // Real, structured tags: the security_scanner step's evidence entries are
  // {type: "security", ref: "<matched keyword>"} — an honest label-like tag
  // sourced from actual keyword-match evidence, not a fabricated category.
  // (GitHub's own issue labels aren't exposed as a structured StepRecord
  // field today — only inside a Python-repr output_summary string — so they
  // aren't parsed here rather than risk a fragile ad-hoc parse.)
  const labels = Array.from(
    new Set(rawEvidence.filter((e) => e.type === "security" && e.ref).map((e) => e.ref))
  );

  return {
    id: detail.investigation_id,
    number: detail.number,
    title: detail.title,
    kind: detail.kind,
    author: "",
    body: lastStep?.input_summary ?? "",
    labels,
    createdAt: detail.created_at,
    decision,
    confidence: detail.confidence ?? 0,
    reason: detail.decision_reason ?? "",
    category: "",
    evidence: allEvidence,
    steps: detail.steps.map(toAgentStep),
    needsAttention: decision === "escalate" || decision === "followup" || detail.status === "running",
    severity: severityFromDecision(detail.decision, detail.confidence),
  };
}

export function escalationToUi(esc: EscalationApi): {
  investigation_id: string;
  reason: string;
  severity: string;
  number: number;
  title: string;
  created_at: string;
} {
  return esc;
}

export function healthApiToHistory(health: HealthResponseApi) {
  return health.history.map((p) => ({
    ts: p.ts,
    backlog: 0,
    response: 0,
    duplicate: 0,
    contributors: 0,
    score: p.score,
  }));
}

/**
 * InvestigationSummary (the list endpoint) has no confidence/reason/evidence
 * — those only exist on InvestigationDetail. Rather than changing the frozen
 * api/schemas.py contract, fetch full detail for each investigation in this
 * repo so every card/row shows real confidence and evidence, not a
 * hardcoded 0. Fine at hackathon/demo scale (a handful of investigations
 * per repo); would need pagination or a richer list schema at real scale.
 */
export async function loadInvestigationsWithDetail(repoName: string): Promise<Investigation[]> {
  const summaries: InvestigationSummary[] = await listInvestigations(repoName);
  const details = await Promise.all(
    summaries.map((s) =>
      getInvestigation(s.investigation_id).then(detailToInvestigation).catch(() => summaryToInvestigation(s))
    )
  );
  return details;
}
