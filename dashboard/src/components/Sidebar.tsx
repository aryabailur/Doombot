import { useState } from "react";
import { NavLink } from "react-router-dom";
import {
  LayoutGrid,
  Bell,
  Copy,
  ShieldAlert,
  Activity,
  BrainCircuit,
  ScrollText,
  FileText,
  GitBranch,
  Settings,
  Check,
  BadgeCheck,
  Share2,
} from "lucide-react";
import { useRepo } from "../lib/RepoContext";
import { indexRepo } from "../lib/api";

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutGrid;
  end?: boolean;
}

const NAV_GROUPS: { label: string | null; items: NavItem[] }[] = [
  {
    label: null,
    items: [{ to: "/", label: "Command Center", icon: LayoutGrid, end: true }],
  },
  {
    label: "Attention",
    items: [
      { to: "/attention", label: "Needs You", icon: Bell },
      { to: "/duplicates", label: "Duplicates", icon: Copy },
      { to: "/security", label: "Security", icon: ShieldAlert },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { to: "/health", label: "Project Health", icon: Activity },
      { to: "/memory", label: "Project Memory", icon: BrainCircuit },
      { to: "/graphs", label: "Graphs", icon: Share2 },
    ],
  },
  {
    label: "Agent",
    items: [
      { to: "/activity", label: "Live Activity", icon: ScrollText },
      { to: "/decisions", label: "Decisions", icon: FileText },
      { to: "/approvals", label: "Approval Center", icon: BadgeCheck },
    ],
  },
  {
    label: null,
    items: [{ to: "/brief", label: "Brief", icon: FileText }],
  },
];

/**
 * Accepts "owner/repo" directly, or a pasted GitHub URL in any common form
 * (https://github.com/owner/repo, with/without .git, with/without a
 * trailing slash, git@github.com:owner/repo.git) and normalizes all of
 * them to "owner/repo". Returns null for anything that isn't recognizably
 * one of those — the caller should reject rather than silently accept
 * garbage that will never match a real repo_name in the backend.
 */
function normalizeRepoInput(input: string): string | null {
  let s = input.trim();
  s = s.replace(/^git@github\.com:/, "");
  s = s.replace(/^https?:\/\/(www\.)?github\.com\//, "");
  s = s.replace(/\.git$/, "");
  s = s.replace(/\/+$/, "");
  const match = s.match(/^([\w.-]+)\/([\w.-]+)$/);
  return match ? `${match[1]}/${match[2]}` : null;
}

export function Sidebar() {
  const { repoName, setRepoName } = useRepo();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(repoName);
  const [indexing, setIndexing] = useState(false);
  const [indexed, setIndexed] = useState(false);
  const [inputError, setInputError] = useState(false);

  function commit() {
    const normalized = normalizeRepoInput(draft);
    if (normalized) {
      setRepoName(normalized);
      setIndexed(false);
      setInputError(false);
      setEditing(false);
    } else if (draft.trim() === "") {
      setEditing(false);
    } else {
      setInputError(true);
    }
  }

  async function handleIndex() {
    const [owner, repo] = repoName.split("/");
    if (!owner || !repo) return;
    setIndexing(true);
    try {
      await indexRepo(owner, repo);
      setIndexed(true);
    } catch {
      // surfaced by page-level error states; sidebar stays silent
    } finally {
      setIndexing(false);
    }
  }

  return (
    <aside className="flex h-screen w-60 flex-none flex-col border-r border-border bg-card">
      <div className="flex items-center gap-2 px-5 py-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink">
          <span className="font-mono text-sm font-bold text-white">■</span>
        </div>
        <span className="font-mono text-sm font-extrabold uppercase tracking-wide text-ink">
          RepoGuardian
        </span>
      </div>

      <div className="mx-4 mb-2">
        {editing ? (
          <>
            <input
              autoFocus
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setInputError(false);
              }}
              onBlur={commit}
              onKeyDown={(e) => e.key === "Enter" && commit()}
              placeholder="owner/repo or a GitHub URL"
              className={`w-full rounded-lg border bg-background px-3 py-2 font-mono text-xs text-ink outline-none ${
                inputError ? "border-danger" : "border-border"
              }`}
            />
            {inputError && (
              <p className="mt-1 text-[11px] text-danger">
                Enter as "owner/repo" (a pasted GitHub URL also works).
              </p>
            )}
          </>
        ) : (
          <button
            onClick={() => {
              setDraft(repoName);
              setEditing(true);
            }}
            className="flex w-full items-center justify-between rounded-lg border border-border bg-background px-3 py-2"
          >
            <span className="truncate font-mono text-xs font-semibold text-ink">{repoName}</span>
            <span className="text-muted">▾</span>
          </button>
        )}
      </div>

      <div className="mx-4 mb-3">
        <button
          onClick={handleIndex}
          disabled={indexing}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-ink transition-colors hover:bg-background disabled:opacity-50"
        >
          {indexed ? (
            <>
              <Check className="h-3.5 w-3.5 text-success" strokeWidth={2.5} />
              Indexed
            </>
          ) : indexing ? (
            "Indexing…"
          ) : (
            "Index Repository"
          )}
        </button>
      </div>

      <div className="mx-4 mb-4 flex items-center gap-1.5 rounded-lg bg-success-soft px-3 py-1.5">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inset-0 rounded-full bg-success animate-agent-pulse-ring" />
          <span className="relative h-1.5 w-1.5 rounded-full bg-success animate-pulse-dot" />
        </span>
        <span className="text-[11px] font-bold uppercase tracking-wide text-success">Agent Online</span>
      </div>

      <nav className="flex-1 overflow-y-auto px-3">
        {NAV_GROUPS.map((group, gi) => (
          <div key={gi} className="mb-4">
            {group.label && (
              <p className="mb-1.5 px-2 text-[10px] font-bold uppercase tracking-widest text-muted">
                {group.label}
              </p>
            )}
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-semibold transition-colors ${
                        isActive
                          ? "translate-x-0.5 bg-ink text-white shadow-flat-sm"
                          : "text-ink/70 hover:bg-background hover:text-ink"
                      }`
                    }
                  >
                    <item.icon className="h-4 w-4" strokeWidth={2.25} />
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-border px-4 py-4">
        <div className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold text-muted">
          <GitBranch className="h-3.5 w-3.5" strokeWidth={2.25} />
          GitHub connected
        </div>
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-accent-soft font-bold text-accent">
            M
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-ink">Maintainer</p>
            <p className="text-[11px] text-muted">{repoName}</p>
          </div>
          <button className="ml-auto text-muted hover:text-ink" aria-label="Settings">
            <Settings className="h-4 w-4" strokeWidth={2.25} />
          </button>
        </div>
      </div>
    </aside>
  );
}
