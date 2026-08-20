import { useEffect, useRef, useState } from "react";

export interface ConfidenceRingProps {
  value: number; // 0..1
  label?: string;
  size?: number;
}

const EASE_OUT_EXPO = (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));

export function ConfidenceRing({ value, label, size = 88 }: ConfidenceRingProps) {
  const radius = (size - 10) / 2;
  const circumference = 2 * Math.PI * radius;
  const color = value >= 0.75 ? "var(--accent)" : value >= 0.5 ? "var(--warning)" : "var(--muted)";

  // Sweep the ring and count the percentage up together on first paint,
  // rather than snapping straight to the final value.
  const [animatedPct, setAnimatedPct] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const targetPct = Math.round(value * 100);

    if (prefersReduced) {
      setAnimatedPct(targetPct);
      return;
    }

    const duration = 1000;
    const start = performance.now();
    function tick(now: number) {
      const t = Math.min(1, (now - start) / duration);
      setAnimatedPct(Math.round(targetPct * EASE_OUT_EXPO(t)));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [value]);

  const offset = circumference * (1 - animatedPct / 100);

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--border)" strokeWidth={7} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={7}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
        <text
          x={size / 2}
          y={size / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          transform={`rotate(90 ${size / 2} ${size / 2})`}
          className="font-mono font-bold"
          style={{ fontSize: size * 0.24, fill: "var(--ink)" }}
        >
          {animatedPct}%
        </text>
      </svg>
      {label && <span className="text-xs font-semibold text-muted">{label}</span>}
    </div>
  );
}
