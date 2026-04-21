import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AgentStatus, Project } from "../types";

export type ViewFilter =
  | { kind: "all" }
  | { kind: "project"; name: string }
  | { kind: "status"; status: AgentStatus };

interface SidebarProps {
  projects: Project[];
  totalAgents: number;
  filter: ViewFilter;
  onFilterChange: (f: ViewFilter) => void;
}

const STAY_ON_TOP_KEY = "claude-code-wsl-vs-supervisor:always-on-top";

function loadAlwaysOnTop(): boolean {
  try {
    return localStorage.getItem(STAY_ON_TOP_KEY) === "true";
  } catch {
    return false;
  }
}

export function Sidebar({
  projects,
  totalAgents,
  filter,
  onFilterChange,
}: SidebarProps) {
  const [alwaysOnTop, setAlwaysOnTop] = useState<boolean>(loadAlwaysOnTop);

  useEffect(() => {
    invoke("set_always_on_top", { enabled: alwaysOnTop }).catch(() => {});
    try {
      localStorage.setItem(STAY_ON_TOP_KEY, alwaysOnTop ? "true" : "false");
    } catch {
      /* ignore */
    }
  }, [alwaysOnTop]);

  const countByStatus = (s: AgentStatus) =>
    projects.reduce((n, p) => n + p.agents.filter((a) => a.status === s).length, 0);

  const dotClassForProject = (p: Project): string => {
    if (p.agents.some((a) => a.status === "thinking")) return "thinking";
    if (p.agents.some((a) => a.status === "coding")) return "coding";
    return "waiting";
  };

  const isActive = (test: (f: ViewFilter) => boolean) => test(filter);
  const isAll = isActive((f) => f.kind === "all");
  const isProj = (name: string) =>
    isActive((f) => f.kind === "project" && f.name === name);
  const isStat = (s: AgentStatus) =>
    isActive((f) => f.kind === "status" && f.status === s);

  return (
    <aside className="side">
      <div className="side-title">
        <span>▸ Vue</span>
        <span className="side-title-sub">tous</span>
      </div>
      <button
        className={`item ${isAll ? "active" : ""}`}
        onClick={() => onFilterChange({ kind: "all" })}
      >
        <span className="dot dot-all" />
        <span className="item-name">Tous les agents</span>
        <span className="item-count">{totalAgents}</span>
      </button>

      <div className="side-sec">
        <div className="side-title">
          <span>▸ Projets</span>
        </div>
        {projects.map((p) => (
          <button
            key={p.name}
            className={`item ${isProj(p.name) ? "active" : ""}`}
            onClick={() => onFilterChange({ kind: "project", name: p.name })}
            title={p.path}
          >
            <span className={`dot dot-${dotClassForProject(p)}`} />
            <span className="item-name">{p.name}</span>
            <span className="item-count">{p.agents.length}</span>
          </button>
        ))}
        {projects.length === 0 && (
          <div className="item-empty">Aucun projet</div>
        )}
      </div>

      <div className="side-sec">
        <div className="side-title">
          <span>▸ Statut</span>
        </div>
        <button
          className={`item ${isStat("thinking") ? "active" : ""}`}
          onClick={() => onFilterChange({ kind: "status", status: "thinking" })}
        >
          <span className="dot dot-thinking" />
          <span className="item-name">pensent</span>
          <span className="item-count">{countByStatus("thinking")}</span>
        </button>
        <button
          className={`item ${isStat("coding") ? "active" : ""}`}
          onClick={() => onFilterChange({ kind: "status", status: "coding" })}
        >
          <span className="dot dot-coding" />
          <span className="item-name">codent</span>
          <span className="item-count">{countByStatus("coding")}</span>
        </button>
        <button
          className={`item ${isStat("waiting") ? "active" : ""}`}
          onClick={() => onFilterChange({ kind: "status", status: "waiting" })}
        >
          <span className="dot dot-waiting" />
          <span className="item-name">attendent</span>
          <span className="item-count">{countByStatus("waiting")}</span>
        </button>
      </div>

      <div className="side-sec">
        <button
          className="act-btn"
          onClick={() => {
            // Forces a page reload; the Rust poller will emit the next
            // agents-update immediately after we reconnect.
            window.location.reload();
          }}
        >
          <span className="act-icon">↻</span>
          <span className="act-label">Rafraîchir</span>
        </button>
        <label className="act-toggle">
          <span className="act-icon">▲</span>
          <span className="act-label">Toujours au-dessus</span>
          <input
            type="checkbox"
            checked={alwaysOnTop}
            onChange={(e) => setAlwaysOnTop(e.target.checked)}
          />
          <span className="act-switch" />
        </label>
      </div>

      <style>{sidebarCss}</style>
    </aside>
  );
}

const sidebarCss = `
.side {
  border-right: 1px solid var(--line);
  padding: 14px 10px;
  background: var(--panel);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.side-title {
  font-size: 9px;
  color: var(--muted);
  letter-spacing: 0.2em;
  text-transform: uppercase;
  padding: 2px 6px 8px;
  display: flex;
  justify-content: space-between;
}
.side-title-sub { color: var(--dim); }

.item {
  display: grid;
  grid-template-columns: 14px 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  margin-bottom: 1px;
  border-radius: 2px;
  cursor: pointer;
  transition: background 0.12s;
  border-left: 2px solid transparent;
  background: transparent;
  border-top: 0; border-right: 0; border-bottom: 0;
  font: inherit;
  color: inherit;
  text-align: left;
  width: 100%;
}
.item:hover { background: rgba(0,255,159,0.05); }
.item.active {
  background: rgba(0,255,159,0.1);
  border-left-color: var(--phosphor);
  padding-left: 6px;
}
.item.active .item-name { color: var(--bright); }
.item-empty { font-size: 10px; color: var(--dim); padding: 6px 8px; font-style: italic; }

.dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--dim);
}
.dot-all {
  background: transparent;
  border: 1px solid var(--phosphor);
  position: relative;
}
.dot-all::after {
  content: ""; position: absolute; inset: 2px;
  background: var(--phosphor); border-radius: 50%;
}
.dot-thinking { background: var(--magenta); box-shadow: 0 0 8px var(--magenta); }
.dot-coding {
  background: var(--phosphor);
  box-shadow: 0 0 8px var(--phosphor);
  animation: pulse-dot 1.5s ease-in-out infinite;
}
.dot-waiting { background: var(--amber); }

.item-name {
  color: var(--text);
  font-size: 11px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.item-count {
  color: var(--muted);
  font-size: 10px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.side-sec {
  margin-top: 18px;
  padding-top: 12px;
  border-top: 1px dashed var(--line);
}

.act-btn, .act-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  margin-bottom: 4px;
  border: 1px solid var(--line-bright);
  border-radius: 3px;
  background: transparent;
  color: var(--text);
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
  user-select: none;
}
.act-btn:hover, .act-toggle:hover {
  border-color: var(--phosphor);
  color: var(--bright);
}
.act-btn:active { transform: translateY(1px); }
.act-icon {
  color: var(--phosphor);
  font-size: 12px;
  width: 12px;
  text-align: center;
}
.act-label { flex: 1; text-align: left; }

.act-toggle input[type="checkbox"] { display: none; }
.act-switch {
  width: 24px; height: 12px;
  border-radius: 8px;
  background: var(--line-bright);
  position: relative;
  transition: background 0.2s;
  flex-shrink: 0;
}
.act-switch::after {
  content: "";
  position: absolute;
  top: 1px; left: 1px;
  width: 10px; height: 10px;
  border-radius: 50%;
  background: var(--muted);
  transition: left 0.2s, background 0.2s;
}
.act-toggle input:checked + .act-switch { background: rgba(0,255,159,0.25); }
.act-toggle input:checked + .act-switch::after { left: 13px; background: var(--phosphor); }
`;
