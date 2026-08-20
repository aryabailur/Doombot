export function formatDuration(ms: number | null): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatRelativeTime(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.round((now - then) / 1000);
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

export function confidenceLabel(score: number | null): {
  label: string;
  tone: "high" | "medium" | "low";
} {
  if (score === null) return { label: "Unknown confidence", tone: "low" };
  if (score >= 0.75) return { label: "High confidence — strong match", tone: "high" };
  if (score >= 0.45) return { label: "Medium confidence — partial match", tone: "medium" };
  return { label: "Low confidence — weak signal", tone: "low" };
}

export function severityTone(severity: string): "critical" | "high" | "warning" | "neutral" {
  const s = severity.toLowerCase();
  if (s === "critical") return "critical";
  if (s === "high") return "high";
  if (s === "medium" || s === "warning") return "warning";
  return "neutral";
}
