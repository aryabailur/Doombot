export interface SkeletonStateProps {
  rows?: number;
  className?: string;
}

export function SkeletonState({ rows = 3, className = "" }: SkeletonStateProps) {
  return (
    <div className={`flex flex-col gap-3 ${className}`} role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-16 animate-pulse rounded-xl border-2 border-border bg-surface-2"
          style={{ animationDelay: `${i * 80}ms` }}
        />
      ))}
    </div>
  );
}
