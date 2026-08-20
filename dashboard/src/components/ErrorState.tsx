import { TriangleAlert } from "lucide-react";

export interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

export function ErrorState({ title = "Something broke", message, onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-border bg-critical/10 px-8 py-16 text-center shadow-brutal-sm">
      <div className="flex h-14 w-14 items-center justify-center rounded-xl border-2 border-border bg-critical shadow-brutal-sm">
        <TriangleAlert className="h-7 w-7 text-white" strokeWidth={2.5} />
      </div>
      <h3 className="font-display text-lg font-bold text-text-primary">{title}</h3>
      <p className="max-w-sm text-sm text-text-secondary">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-2 rounded-lg border-2 border-border bg-surface-1 px-4 py-2 text-sm font-bold shadow-brutal-sm transition-transform hover:-translate-y-0.5 hover:shadow-brutal active:translate-y-0 active:shadow-none"
        >
          Try again
        </button>
      )}
    </div>
  );
}
