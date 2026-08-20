import { AreaChart, Area, ResponsiveContainer, XAxis, Tooltip } from "recharts";

export interface HealthChartProps {
  data: { ts: string; value: number }[];
  color?: string;
  height?: number;
}

export function HealthChart({ data, color = "var(--accent)", height = 90 }: HealthChartProps) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id="healthFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.25} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="ts" hide />
          <Tooltip
            contentStyle={{
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              boxShadow: "3px 3px 0 0 var(--shadow-color)",
            }}
            labelFormatter={(v) => (v ? new Date(String(v)).toLocaleDateString() : "")}
          />
          <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill="url(#healthFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
