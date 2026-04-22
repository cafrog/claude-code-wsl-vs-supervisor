import { invoke } from "@tauri-apps/api/core";
import type { Agent, AgentStatus, Project } from "../types";
import { AgentRow } from "./AgentRow";

interface ProjectBlockProps {
  project: Project;
  collapsed: boolean;
  onToggleCollapse: (name: string) => void;
  selectedAgentPid: number | null;
  onOpenChat: (agent: Agent) => void;
  onDragStart: (name: string) => void;
  onDragEnter: (name: string) => void;
  onDragEnd: () => void;
  onDrop: (name: string, e: React.DragEvent) => void;
  isDragging: boolean;
  isDropTarget: boolean;
}

function dotsForProject(agents: Agent[]): AgentStatus[] {
  return agents.map((a) => a.status);
}

type RecentInfo = {
  agent: Agent;
  ts: number;
  snippet: string;
  kind: "user" | "assistant";
};

function mostRecentInteraction(agents: Agent[]): RecentInfo | null {
  let best: RecentInfo | null = null;
  for (const a of agents) {
    const msgTs = a.lastMessageAt ?? 0;
    const respTs = a.lastResponseAt ?? 0;
    const ts = Math.max(msgTs, respTs);
    if (ts <= 0) continue;
    const kind: "user" | "assistant" = respTs >= msgTs ? "assistant" : "user";
    const snippet =
      (kind === "assistant" ? a.lastResponse : a.lastMessage) ?? "";
    if (!best || ts > best.ts) best = { agent: a, ts, snippet, kind };
  }
  return best;
}

function formatShortDelta(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h`;
}

function freshnessClass(ms: number): string {
  if (ms < 60_000) return "fresh";
  if (ms < 10 * 60_000) return "medium";
  return "stale";
}

export function ProjectBlock({
  project,
  collapsed,
  onToggleCollapse,
  selectedAgentPid,
  onOpenChat,
  onDragStart,
  onDragEnter,
  onDragEnd,
  onDrop,
  isDragging,
  isDropTarget,
}: ProjectBlockProps) {
  const dots = dotsForProject(project.agents);
  const activeCount = project.agents.filter((a) => a.status !== "waiting").length;
  const recent = mostRecentInteraction(project.agents);
  const recentAge = recent ? Date.now() - recent.ts : null;
  const recentName = recent
    ? recent.agent.name ?? `#${recent.agent.pid}`
    : null;

  function handleJump(e: React.MouseEvent) {
    e.stopPropagation();
    invoke("focus_agent", {
      projectPath: project.path,
      pid: 0,
    }).catch(() => {});
  }

  function handleChevron(e: React.MouseEvent) {
    e.stopPropagation();
    onToggleCollapse(project.name);
  }


  return (
    <section
      className={`pblock ${collapsed ? "collapsed" : ""} ${isDragging ? "dragging" : ""} ${isDropTarget ? "drop-target" : ""}`}
      draggable
      onDragStart={(e) => {
        onDragStart(project.name);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", project.name);
      }}
      onDragEnd={onDragEnd}
      onDragEnter={(e) => {
        e.preventDefault();
        onDragEnter(project.name);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDrop={(e) => onDrop(project.name, e)}
    >
      <div className="phead">
        <span className="phandle" aria-hidden="true">⋮⋮</span>
        <button className="pchevron" onClick={handleChevron} aria-label="Replier">
          {collapsed ? "▸" : "▾"}
        </button>
        <span className="pname">{project.name}</span>
        <button
          className="pjump"
          title="Ouvrir dans VS Code"
          onClick={handleJump}
        >
          ↗
        </button>
        <span className="pdots">
          {dots.map((s, i) => (
            <span key={i} className={`d dot-${s}`} />
          ))}
        </span>
        <span className="pmeta">
          <b>{project.agents.length}</b> agent{project.agents.length > 1 ? "s" : ""}
          {" · "}
          <b>{activeCount}</b> actif{activeCount > 1 ? "s" : ""}
          {recentAge != null && (
            <>
              {" · "}
              <b className={`pmeta-delta ${freshnessClass(recentAge)}`}>
                {formatShortDelta(recentAge)}
              </b>
            </>
          )}
        </span>
      </div>
      {collapsed && recent && (
        <div className="plast">
          <span className="plast-agent">{recentName}</span>
          <span className={`plast-arrow ${recent.kind}`}>
            {recent.kind === "assistant" ? "‹" : "›"}
          </span>
          <span className="plast-snippet">{recent.snippet}</span>
        </div>
      )}
      {!collapsed && (
        <div className="pagents">
          {project.agents.map((a) => (
            <AgentRow
              key={a.pid}
              agent={a}
              selected={a.pid === selectedAgentPid}
              onOpenChat={onOpenChat}
            />
          ))}
        </div>
      )}
      <style>{pCss}</style>
    </section>
  );
}

const pCss = `
.pblock {
  margin-bottom: 2px;
  transition: opacity 0.2s;
}
.pblock.dragging { opacity: 0.35; }
.pblock.drop-target .phead {
  box-shadow: inset 0 3px 0 0 var(--phosphor);
}
.phead {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 12px 8px;
  border-bottom: 1px solid var(--line);
  background: linear-gradient(90deg, rgba(0,255,159,0.04) 0%, transparent 60%);
  position: sticky;
  top: 33px;
  z-index: 4;
  cursor: grab;
  user-select: none;
}
.phead:active { cursor: grabbing; }
.phead:hover {
  background: linear-gradient(90deg, rgba(0,255,159,0.08) 0%, transparent 60%);
}
.phandle {
  color: var(--dim);
  font-size: 13px;
  letter-spacing: -2px;
  line-height: 0.6;
  padding: 0 2px;
}
.phead:hover .phandle { color: var(--soft); }
.pchevron {
  background: transparent;
  border: 0;
  color: var(--phosphor);
  font-size: 10px;
  cursor: pointer;
  padding: 2px 4px;
  font-family: inherit;
}
.pname {
  font-family: "Space Grotesk", sans-serif;
  font-weight: 700;
  font-size: 13px;
  color: var(--bright);
  letter-spacing: 0.01em;
}
.pjump {
  background: transparent;
  border: 1px solid var(--line-bright);
  color: var(--muted);
  font-size: 11px;
  padding: 1px 7px 2px;
  border-radius: 2px;
  cursor: pointer;
  font-family: inherit;
  line-height: 1;
  transition: all 0.15s;
}
.pjump:hover {
  color: var(--phosphor);
  border-color: var(--phosphor);
  background: rgba(0,255,159,0.08);
}
.pdots { display: flex; gap: 3px; }
.pdots .d {
  width: 7px; height: 7px; border-radius: 50%;
}
.pdots .d.dot-thinking { background: var(--magenta); box-shadow: 0 0 6px var(--magenta); }
.pdots .d.dot-coding { background: var(--phosphor); box-shadow: 0 0 6px var(--phosphor); }
.pdots .d.dot-waiting { background: var(--amber); }
.pmeta {
  font-size: 10px;
  color: var(--muted);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}
.pmeta b { color: var(--text); }
.pmeta .pmeta-delta.fresh {
  color: var(--phosphor);
  text-shadow: 0 0 6px rgba(0, 255, 159, 0.35);
}
.pmeta .pmeta-delta.medium { color: var(--amber); }
.pmeta .pmeta-delta.stale { color: var(--muted); }

.plast {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 4px 12px 8px 38px;
  font-size: 11px;
  color: var(--muted);
  background: linear-gradient(90deg, rgba(0, 255, 159, 0.025) 0%, transparent 55%);
  border-bottom: 1px solid var(--line);
  overflow: hidden;
  min-width: 0;
}
.plast-agent {
  color: var(--bright);
  font-weight: 500;
  font-size: 11px;
  flex-shrink: 0;
}
.plast-arrow {
  font-weight: 700;
  line-height: 1;
  flex-shrink: 0;
}
.plast-arrow.assistant { color: var(--phosphor); }
.plast-arrow.user { color: var(--amber); }
.plast-snippet {
  color: var(--soft);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
  font-style: italic;
}

.pagents {
  display: grid;
  grid-template-columns: 78px 200px minmax(0, 1fr) minmax(0, 1fr) 64px;
}
`;
