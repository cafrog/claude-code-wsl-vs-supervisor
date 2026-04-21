import { invoke } from "@tauri-apps/api/core";
import type { Agent } from "../types";
import { ExpandableText } from "./ExpandableText";
import { Markdown } from "./Markdown";

interface AgentRowProps {
  agent: Agent;
  selected?: boolean;
  onOpenChat: (agent: Agent) => void;
}

function formatDelta(timestamp: number, now: number): string {
  const diff = Math.max(0, now - timestamp);
  const s = Math.floor(diff / 1000);
  const m = Math.floor(diff / 60_000);
  const h = Math.floor(diff / 3_600_000);
  if (s < 60) return `${s}s`;
  if (m < 60) return `${m}m`;
  return `${h}h`;
}

function isAgentWorking(agent: Agent): boolean {
  // Only show the typing bubble when the backend agrees the agent is active.
  // The backend already forces status=thinking for the first 60s after a new
  // prompt (its recent-pending override), so once it reverts to "waiting"
  // the agent really isn't doing anything — showing "Travaille…" would be a
  // false positive.
  if (agent.status === "waiting") return false;
  if (!agent.lastMessage || !agent.lastMessageAt) return false;
  if (!agent.lastResponseAt) return true;
  return agent.lastMessageAt > agent.lastResponseAt;
}

export function AgentRow({ agent, selected, onOpenChat }: AgentRowProps) {
  const displayName = agent.name ?? `Agent #${agent.pid}`;
  const working = isAgentWorking(agent);
  const badgeClass = `badge badge-${agent.status}`;
  const badgeLabel =
    agent.status === "thinking"
      ? "PENSE"
      : agent.status === "coding"
      ? "CODE"
      : "ATTEND";

  function handleJump(e: React.MouseEvent) {
    e.stopPropagation();
    invoke("focus_agent", {
      projectPath: agent.projectPath,
      pid: agent.pid,
    }).catch(() => {});
  }

  function handleRowClick() {
    onOpenChat(agent);
  }

  return (
    <div
      className={`arow ${selected ? "selected" : ""}`}
      onClick={handleRowClick}
      role="button"
      tabIndex={0}
    >
      <div className="c-status">
        <span className={badgeClass}>{badgeLabel}</span>
      </div>
      <div className="c-agent">
        <span className="aname">{displayName}</span>
        <button
          className="ajump"
          title="Ouvrir terminal dans VS Code"
          onClick={handleJump}
        >
          ↗
        </button>
      </div>
      <div className="c-msg">
        {agent.lastMessage ? (
          <ExpandableText text={agent.lastMessage} prefix="› " />
        ) : (
          <span className="cell-empty">—</span>
        )}
      </div>
      <div className="c-resp">
        {working ? (
          <TypingIndicator status={agent.status} />
        ) : agent.lastResponse ? (
          <ExpandableText
            text={agent.lastResponse}
            className="is-resp"
          >
            <span className="xt-prefix">‹ </span>
            <Markdown>{agent.lastResponse}</Markdown>
          </ExpandableText>
        ) : (
          <span className="cell-empty">—</span>
        )}
      </div>
      <div className="c-time">
        {formatDelta(agent.lastMessageAt ?? agent.startedAt, Date.now())}
      </div>

      <style>{rowCss}</style>
    </div>
  );
}

function TypingIndicator({ status }: { status: Agent["status"] }) {
  const label =
    status === "coding"
      ? "Code…"
      : status === "thinking"
      ? "Réfléchit…"
      : "Travaille…";
  return (
    <span className="typing">
      {label}
      <span className="typing-dots">
        <span /> <span /> <span />
      </span>
    </span>
  );
}

const rowCss = `
.arow {
  display: contents;
  cursor: pointer;
}
.arow > div {
  padding: 10px;
  border-bottom: 1px solid var(--line);
  transition: background 0.1s;
  min-width: 0;
  position: relative;
}
.arow:hover > div { background: rgba(0,255,159,0.04); }
.arow.selected > div {
  background: rgba(0,255,159,0.07) !important;
  box-shadow: inset 2px 0 0 0 var(--phosphor);
}

.c-status { display: flex; align-items: center; gap: 6px; padding-left: 12px; }
.badge {
  font-size: 9px;
  letter-spacing: 0.15em;
  padding: 2px 7px;
  border-radius: 2px;
  border: 1px solid;
  font-weight: 500;
}
.badge-thinking {
  color: var(--magenta);
  border-color: rgba(255,46,126,0.3);
  background: rgba(255,46,126,0.06);
}
.badge-coding {
  color: var(--phosphor);
  border-color: rgba(0,255,159,0.3);
  background: rgba(0,255,159,0.06);
}
.badge-waiting {
  color: var(--amber);
  border-color: rgba(255,176,0,0.3);
  background: rgba(255,176,0,0.06);
}

.c-agent { display: flex; align-items: flex-start; gap: 6px; }
.aname { color: var(--bright); font-weight: 500; }
.ajump {
  background: transparent;
  border: 1px solid var(--line-bright);
  color: var(--dim);
  font-size: 10px;
  padding: 2px 6px 3px;
  border-radius: 2px;
  cursor: pointer;
  font-family: inherit;
  line-height: 1;
  opacity: 0;
  transition: all 0.15s;
}
.arow:hover .ajump { opacity: 1; }
.ajump:hover {
  color: var(--phosphor);
  border-color: var(--phosphor);
  background: rgba(0,255,159,0.08);
}

.c-resp .is-resp .xt-body,
.c-resp .is-resp { color: var(--soft); }
.cell-empty { color: var(--dim); font-size: 10px; }

.typing {
  color: var(--magenta);
  font-style: italic;
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.typing-dots { display: inline-flex; gap: 3px; }
.typing-dots span {
  width: 4px; height: 4px;
  background: var(--magenta);
  border-radius: 50%;
  animation: typing-dot 1.2s infinite;
}
.typing-dots span:nth-child(2) { animation-delay: 0.15s; }
.typing-dots span:nth-child(3) { animation-delay: 0.3s; }

.c-time {
  color: var(--muted);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  text-align: right;
  padding-right: 12px;
}
`;
