import { LineChart, Line, ResponsiveContainer, YAxis, Tooltip } from "recharts";
import type { HealthPoint } from "../lib/types";

export interface HealthTrendChartProps {
  history: HealthPoint[];
}

export function HealthTrendChart({ history }: HealthTrendChartProps) {
  if (history.length === 0) {
    return <p className="text-xs text-text-muted">No history yet.</p>;
  }

  return (
    <div className="rounded-xl border-2 border-border bg-surface-1 p-4 shadow-brutal">
      <h3 className="mb-2 font-display text-sm font-bold uppercase tracking-wide">
        Health Trend
      </h3>
      <div className="h-28 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={history}>
            <YAxis domain={[0, 100]} hide />
            <Tooltip
              contentStyle={{
                border: "2px solid var(--border)",
                borderRadius: 8,
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                boxShadow: "4px 4px 0 0 var(--shadow-color)",
              }}
              labelFormatter={(v) => (v ? new Date(String(v)).toLocaleDateString() : "")}
            />
            <Line
              type="monotone"
              dataKey="score"
              stroke="var(--accent)"
              strokeWidth={3}
              dot={{ stroke: "var(--border)", strokeWidth: 2, fill: "var(--accent)", r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>Health score history</caption>
        <thead>
          <tr>
            <th>Date</th>
            <th>Score</th>
          </tr>
        </thead>
        <tbody>
          {history.map((p) => (
            <tr key={p.ts}>
              <td>{new Date(p.ts).toLocaleDateString()}</td>
              <td>{p.score}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
