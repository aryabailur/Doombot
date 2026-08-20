import type { LucideIcon } from "lucide-react";

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-border bg-surface-2 px-8 py-16 text-center shadow-brutal-sm">
      {Icon && (
        <div className="flex h-14 w-14 items-center justify-center rounded-xl border-2 border-border bg-surface-1 shadow-brutal-sm">
          <Icon className="h-7 w-7 text-text-muted" strokeWidth={2.5} />
        </div>
      )}
      <h3 className="font-display text-lg font-bold text-text-primary">{title}</h3>
      {description && <p className="max-w-sm text-sm text-text-secondary">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
