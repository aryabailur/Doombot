import { useEffect, useState } from "react";
import { AreaChart, Area, ResponsiveContainer, XAxis, Tooltip, Dot } from "recharts";

export interface HealthChartProps {
  data: { ts: string; value: number }[];
  color?: string;
  height?: number;
}

function ActiveDot(props: { cx?: number; cy?: number; stroke?: string }) {
  const { cx, cy, stroke } = props;
  if (cx === undefined || cy === undefined) return null;
  return <Dot cx={cx} cy={cy} r={4} fill={stroke} stroke="white" strokeWidth={2} className="animate-chart-point" />;
}

export function HealthChart({ data, color = "var(--accent)", height = 90 }: HealthChartProps) {
  const gradientId = "healthFill-" + color.replace(/[^a-zA-Z0-9]/g, "");
  const prefersReduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  // Re-key on data length so re-mounting a fresh dataset (e.g. switching
  // repos) replays the draw-in animation instead of looking static.
  const [animKey, setAnimKey] = useState(0);
  useEffect(() => {
    setAnimKey((k) => k + 1);
  }, [data.length]);

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart key={animKey} data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
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
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            isAnimationActive={!prefersReduced}
            animationDuration={1200}
            animationEasing="ease-out"
            dot={<ActiveDot />}
            activeDot={{ r: 5, strokeWidth: 2, stroke: "white" }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
