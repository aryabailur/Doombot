import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { useRepo } from "../lib/RepoContext";
import { getInvestigation, listInvestigations } from "../lib/api";
import { detailToInvestigation } from "../lib/adapters";
import { EvidenceChip } from "../components/EvidenceChip";
import type { Investigation } from "../lib/seed";

interface SecurityFinding {
  investigation: Investigation;
  keywords: string[];
  relevance: number;
}

// security_scanner.py always emits type:"security" evidence at score 1.0
// per matched keyword — that score measures "keyword matched", not "how
// security-relevant is this issue overall". Relevance here instead scales
// with signal density (how many distinct security keywords fired), which
// is a genuinely different, more informative number than the flat 1.0s or
// the overall decision confidence reused elsewhere in the app.
function computeRelevance(keywordCount: number): number {
  return Math.min(0.6 + keywordCount * 0.12, 0.98);
}

export function SecuritySignals() {
  const navigate = useNavigate();
  const { repoName } = useRepo();
  const [flagged, setFlagged] = useState<SecurityFinding[] | null>(null);
  const [totalInvestigations, setTotalInvestigations] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    listInvestigations(repoName)
      .then(async (rows) => {
        if (cancelled) return;
        setTotalInvestigations(rows.length);
        const details = await Promise.all(rows.map((r) => getInvestigation(r.investigation_id)));
        if (cancelled) return;
        // Filter on the raw API step evidence (type === "security") before
        // it's lossily collapsed into the UI's coarser "decision" kind by
        // detailToInvestigation — the adapter merges security/impact/label/
        // decision evidence into one bucket, so filtering after conversion
        // can't distinguish a real security finding from an impact score.
        const findings: SecurityFinding[] = [];
        for (const d of details) {
          const securityEvidence = d.steps.flatMap((s) => s.evidence).filter((e) => e.type === "security");
          if (securityEvidence.length === 0) continue;
          const keywords = Array.from(new Set(securityEvidence.map((e) => e.ref)));
          findings.push({
            investigation: detailToInvestigation(d),
            keywords,
            relevance: computeRelevance(keywords.length),
          });
        }
        setFlagged(findings);
      })
      .catch(() => setFlagged([]));
    return () => {
      cancelled = true;
    };
  }, [repoName]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-extrabold text-ink">Security Signals</h1>
        <p className="text-sm text-muted">Repository-history-aware security triage for {repoName}.</p>
      </div>

      {flagged === null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : totalInvestigations === 0 ? (
        <p className="text-sm text-muted">
          No investigations have been run on {repoName} yet — security signals will show up here
          once issues have been investigated.
        </p>
      ) : flagged.length === 0 ? (
        <p className="text-sm text-muted">
          No unresolved security signals across {totalInvestigations} investigation
          {totalInvestigations === 1 ? "" : "s"}. The agent found no evidence requiring escalation.
        </p>
      ) : (
        flagged.map(({ investigation: inv, keywords, relevance }) => (
          <div key={inv.id} className="rounded-2xl border border-border border-l-4 border-l-security bg-card p-6 shadow-flat-sm">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-security" strokeWidth={2.25} />
                <span className="text-xs font-bold uppercase tracking-wide text-security">Security Signal</span>
              </div>
              <span className="rounded-full bg-security-soft px-2.5 py-1 font-mono text-xs font-bold text-security">
                {Math.round(relevance * 100)}% security relevance
              </span>
            </div>
            <p className="font-mono text-xs text-muted">#{inv.number}</p>
            <h3 className="text-lg font-bold text-ink">{inv.title}</h3>
            <p className="mt-2 text-sm text-ink/80">{inv.reason}</p>

            <div className="mt-3 flex flex-wrap gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wide text-muted">Affected subsystem</span>
              {keywords.map((kw) => (
                <span
                  key={kw}
                  className="rounded-full border border-security bg-security-soft px-2 py-0.5 font-mono text-[10px] font-semibold text-security"
                >
                  {kw}
                </span>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {inv.evidence.map((ev, i) => (
                <EvidenceChip key={i} evidence={ev} />
              ))}
            </div>
            <p className="mt-3 font-mono text-xs font-semibold text-muted">
              Decision confidence: {Math.round(inv.confidence * 100)}%
            </p>
            <p className="mt-3 rounded-lg bg-security-soft px-3 py-2 text-xs italic text-ink/70">
              Not a vulnerability verdict. Repository context suggests maintainer review.
            </p>
            <button
              onClick={() => navigate(`/issue/${inv.id}`)}
              className="mt-4 rounded-lg bg-ink px-3.5 py-2 text-xs font-bold uppercase tracking-wide text-white"
            >
              Investigate
            </button>
          </div>
        ))
      )}
    </div>
  );
}
