import { useMemo, useRef, useState } from "react";
import { useAgents } from "./hooks/useAgents";
import { useProjectOrder } from "./hooks/useProjectOrder";
import { Sidebar, type ViewFilter } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { ProjectBlock } from "./components/ProjectBlock";
import { ChatPanel, type ChatTarget } from "./components/ChatPanel";
import type { Agent, Project } from "./types";
import "./App.css";

const COLLAPSE_STORAGE_KEY = "claude-code-wsl-vs-supervisor:collapsed-projects";

function loadCollapsed(): Record<string, boolean> {
  try {
    const v = localStorage.getItem(COLLAPSE_STORAGE_KEY);
    return v ? JSON.parse(v) : {};
  } catch {
    return {};
  }
}
function saveCollapsed(m: Record<string, boolean>): void {
  try {
    localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(m));
  } catch {
    /* ignore */
  }
}

export default function App() {
  const { projects, totalAgents } = useAgents();
  const { orderedProjects, moveProject } = useProjectOrder(projects);

  const [filter, setFilter] = useState<ViewFilter>({ kind: "all" });
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(loadCollapsed);
  // Store a STABLE identifier for the chat target, then resolve it to the
  // latest agent/project data on every render so the panel updates live.
  const [chatTargetPid, setChatTargetPid] = useState<number | null>(null);

  const chatTarget: ChatTarget | null = useMemo(() => {
    if (chatTargetPid == null) return null;
    for (const p of orderedProjects) {
      const a = p.agents.find((x) => x.pid === chatTargetPid);
      if (a) return { kind: "agent", agent: a };
    }
    return null;
  }, [chatTargetPid, orderedProjects]);

  const draggedRef = useRef<string | null>(null);
  const [dragName, setDragName] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  // Apply filters + search
  const visibleProjects = useMemo<Project[]>(() => {
    const q = search.trim().toLowerCase();
    const matchAgent = (a: Agent) => {
      if (q) {
        const haystack =
          `${a.name ?? ""} ${a.project} ${a.lastMessage ?? ""} ${a.lastResponse ?? ""} #${a.pid}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (filter.kind === "status" && a.status !== filter.status) return false;
      return true;
    };
    return orderedProjects
      .filter((p) => {
        if (filter.kind === "project" && p.name !== filter.name) return false;
        if (q && !p.name.toLowerCase().includes(q) &&
            !p.agents.some(matchAgent)) return false;
        return true;
      })
      .map((p) => ({ ...p, agents: p.agents.filter(matchAgent) }))
      .filter((p) => p.agents.length > 0);
  }, [orderedProjects, filter, search]);

  function toggleCollapse(name: string) {
    setCollapsed((m) => {
      const next = { ...m, [name]: !m[name] };
      saveCollapsed(next);
      return next;
    });
  }

  function toggleAll() {
    const anyExpanded = orderedProjects.some((p) => !collapsed[p.name]);
    const next: Record<string, boolean> = {};
    for (const p of orderedProjects) next[p.name] = anyExpanded;
    setCollapsed(next);
    saveCollapsed(next);
  }
  const anyExpanded = orderedProjects.some((p) => !collapsed[p.name]);

  function onDragStart(name: string) {
    draggedRef.current = name;
    setDragName(name);
  }
  function onDragEnter(name: string) {
    if (draggedRef.current && draggedRef.current !== name) {
      setDragOver(name);
    }
  }
  function onDragEnd() {
    draggedRef.current = null;
    setDragName(null);
    setDragOver(null);
  }
  function onDrop(name: string, e: React.DragEvent) {
    e.preventDefault();
    const from = e.dataTransfer.getData("text/plain") || draggedRef.current;
    if (from && from !== name) {
      moveProject(from, name);
    }
    onDragEnd();
  }

  function openAgentChat(agent: Agent) {
    setChatTargetPid(agent.pid);
  }

  const totalVisibleAgents = visibleProjects.reduce(
    (n, p) => n + p.agents.length,
    0
  );

  const crumbTitle =
    filter.kind === "all"
      ? "Tous les agents"
      : filter.kind === "project"
      ? `Projet · ${filter.name}`
      : `Statut · ${filter.status === "thinking" ? "pensent" : filter.status === "coding" ? "codent" : "attendent"}`;

  return (
    <div className="chrome">
      <TopBar search={search} onSearchChange={setSearch} />

      <Sidebar
        projects={orderedProjects}
        totalAgents={totalAgents}
        filter={filter}
        onFilterChange={setFilter}
      />

      <main className="main">
        <div className="crumb">
          <div className="crumb-title">{crumbTitle}</div>
          <div className="crumb-meta">
            <b>{totalVisibleAgents}</b> agent{totalVisibleAgents > 1 ? "s" : ""}
            {" sur "}
            <b>{visibleProjects.length}</b> projet
            {visibleProjects.length > 1 ? "s" : ""}
          </div>
          <button className="collapse-all" onClick={toggleAll}>
            <span>⇕</span>
            {anyExpanded ? "Tout replier" : "Tout déplier"}
          </button>
        </div>

        <div className="master-head">
          <div className="th">statut</div>
          <div className="th">agent</div>
          <div className="th">dernier message</div>
          <div className="th">dernière réponse</div>
          <div className="th right">δt</div>
        </div>

        <div className="plist">
          {visibleProjects.length === 0 ? (
            <div className="empty">Aucun agent ne correspond à ce filtre</div>
          ) : (
            visibleProjects.map((p) => (
              <ProjectBlock
                key={p.name}
                project={p}
                collapsed={!!collapsed[p.name]}
                onToggleCollapse={toggleCollapse}
                selectedAgentPid={chatTarget?.agent.pid ?? null}
                onOpenChat={openAgentChat}
                onDragStart={onDragStart}
                onDragEnter={onDragEnter}
                onDragEnd={onDragEnd}
                onDrop={onDrop}
                isDragging={dragName === p.name}
                isDropTarget={dragOver === p.name}
              />
            ))
          )}
        </div>
      </main>

      <ChatPanel target={chatTarget} onClose={() => setChatTargetPid(null)} />

      <style>{appCss}</style>
    </div>
  );
}

const appCss = `
.chrome {
  display: grid;
  grid-template-columns: 250px 1fr;
  grid-template-rows: 40px 1fr;
  width: 100%;
  height: 100vh;
}
.main {
  padding: 14px 20px 20px;
  overflow-y: auto;
  min-width: 0;
}
.crumb {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 14px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
}
.crumb-title {
  font-family: "Space Grotesk", sans-serif;
  font-size: 16px;
  font-weight: 500;
  color: var(--bright);
  letter-spacing: -0.01em;
}
.crumb-meta {
  font-size: 10px;
  color: var(--muted);
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.crumb-meta b { color: var(--bright); font-variant-numeric: tabular-nums; }

.collapse-all {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--panel);
  border: 1px solid var(--line-bright);
  border-radius: 3px;
  color: var(--text);
  font-family: "JetBrains Mono", monospace;
  font-size: 10px;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.15s;
}
.collapse-all:hover {
  border-color: var(--phosphor);
  color: var(--bright);
  background: rgba(0,255,159,0.05);
}
.collapse-all span { color: var(--phosphor); font-size: 12px; letter-spacing: 0; }

.master-head {
  display: grid;
  grid-template-columns: 78px 200px minmax(0, 1fr) minmax(0, 1fr) 64px;
  position: sticky;
  top: 0;
  background: var(--panel);
  z-index: 5;
  border-bottom: 1px solid var(--line-bright);
}
.master-head .th {
  color: var(--muted);
  font-size: 9px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  padding: 8px 10px;
}
.master-head .th:first-child { padding-left: 12px; }
.master-head .th.right { text-align: right; }

.plist { display: flex; flex-direction: column; }

.empty {
  padding: 40px 16px;
  text-align: center;
  color: var(--dim);
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
`;
