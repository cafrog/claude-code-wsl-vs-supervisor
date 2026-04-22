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
const SORT_STORAGE_KEY = "claude-code-wsl-vs-supervisor:sort";

type SortKey = "default" | "status" | "agent" | "lastMessage" | "lastResponse" | "delta";
type SortDir = "asc" | "desc";
type SortState = { key: SortKey; dir: SortDir };

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

function loadSort(): SortState {
  try {
    const v = localStorage.getItem(SORT_STORAGE_KEY);
    if (!v) return { key: "default", dir: "asc" };
    const parsed = JSON.parse(v);
    if (parsed && typeof parsed.key === "string" && typeof parsed.dir === "string") {
      return { key: parsed.key, dir: parsed.dir };
    }
  } catch {
    /* ignore */
  }
  return { key: "default", dir: "asc" };
}
function saveSort(s: SortState): void {
  try {
    localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

const STATUS_RANK: Record<string, number> = { thinking: 0, coding: 1, waiting: 2 };

function compareAgents(a: Agent, b: Agent, key: SortKey): number {
  switch (key) {
    case "status":
      return (STATUS_RANK[a.status] ?? 99) - (STATUS_RANK[b.status] ?? 99);
    case "agent":
      return (a.name ?? `#${a.pid}`).localeCompare(b.name ?? `#${b.pid}`);
    case "lastMessage":
      // asc = most recent first (highest ts on top)
      return (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0);
    case "lastResponse":
      return (b.lastResponseAt ?? 0) - (a.lastResponseAt ?? 0);
    case "delta":
      // asc = freshest first (smallest elapsed)
      return (b.lastMessageAt ?? b.startedAt) - (a.lastMessageAt ?? a.startedAt);
    default:
      return 0;
  }
}

function sortAgents(agents: Agent[], s: SortState): Agent[] {
  if (s.key === "default") return agents;
  const sign = s.dir === "asc" ? 1 : -1;
  return [...agents].sort((a, b) => sign * compareAgents(a, b, s.key));
}

function compareProjectsBySort(a: Project, b: Project, s: SortState): number {
  if (s.key === "default") return 0;
  const pickBest = (agents: Agent[]): Agent | null => {
    if (agents.length === 0) return null;
    return [...agents].sort((x, y) => compareAgents(x, y, s.key))[0];
  };
  const aBest = pickBest(a.agents);
  const bBest = pickBest(b.agents);
  if (!aBest && !bBest) return 0;
  if (!aBest) return 1;
  if (!bBest) return -1;
  return compareAgents(aBest, bBest, s.key);
}

export default function App() {
  const { projects, totalAgents } = useAgents();
  const { orderedProjects, moveProject } = useProjectOrder(projects);

  const [filter, setFilter] = useState<ViewFilter>({ kind: "all" });
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(loadCollapsed);
  const [sort, setSort] = useState<SortState>(loadSort);
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
    const filtered = orderedProjects
      .filter((p) => {
        if (filter.kind === "project" && p.name !== filter.name) return false;
        if (q && !p.name.toLowerCase().includes(q) &&
            !p.agents.some(matchAgent)) return false;
        return true;
      })
      .map((p) => ({
        ...p,
        agents: sortAgents(p.agents.filter(matchAgent), sort),
      }))
      .filter((p) => p.agents.length > 0);

    if (sort.key === "default") return filtered;
    const sign = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort(
      (a, b) => sign * compareProjectsBySort(a, b, sort)
    );
  }, [orderedProjects, filter, search, sort]);

  function toggleSort(key: SortKey) {
    setSort((prev) => {
      let next: SortState;
      if (prev.key !== key) next = { key, dir: "asc" };
      else if (prev.dir === "asc") next = { key, dir: "desc" };
      else next = { key: "default", dir: "asc" };
      saveSort(next);
      return next;
    });
  }

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
          <SortHeader label="statut" k="status" sort={sort} onSort={toggleSort} />
          <SortHeader label="agent" k="agent" sort={sort} onSort={toggleSort} />
          <SortHeader label="dernier message" k="lastMessage" sort={sort} onSort={toggleSort} />
          <SortHeader label="dernière réponse" k="lastResponse" sort={sort} onSort={toggleSort} />
          <SortHeader label="δt" k="delta" sort={sort} onSort={toggleSort} align="right" />
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

interface SortHeaderProps {
  label: string;
  k: SortKey;
  sort: SortState;
  onSort: (k: SortKey) => void;
  align?: "right";
}

function SortHeader({ label, k, sort, onSort, align }: SortHeaderProps) {
  const active = sort.key === k;
  const indicator = !active ? "↕" : sort.dir === "asc" ? "↑" : "↓";
  return (
    <button
      className={`th sortable ${active ? "active" : ""} ${align === "right" ? "right" : ""}`}
      onClick={() => onSort(k)}
      type="button"
    >
      <span className="th-label">{label}</span>
      <span className={`th-arrow ${active ? "on" : "off"}`}>{indicator}</span>
    </button>
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
  background: transparent;
  border: 0;
  font-family: inherit;
  text-align: left;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: color 0.12s, background 0.12s;
}
.master-head .th.sortable {
  cursor: pointer;
  user-select: none;
}
.master-head .th.sortable:hover {
  color: var(--text);
  background: rgba(0, 255, 159, 0.04);
}
.master-head .th.active {
  color: var(--phosphor);
}
.master-head .th.active .th-label {
  text-shadow: 0 0 4px rgba(0, 255, 159, 0.25);
}
.master-head .th:first-child { padding-left: 12px; }
.master-head .th.right { text-align: right; justify-content: flex-end; }
.master-head .th .th-arrow {
  font-size: 9px;
  line-height: 1;
  letter-spacing: 0;
  transition: color 0.12s, opacity 0.12s;
}
.master-head .th .th-arrow.off {
  opacity: 0.25;
}
.master-head .th .th-arrow.on {
  opacity: 1;
  color: var(--phosphor);
}
.master-head .th.sortable:hover .th-arrow.off { opacity: 0.7; }

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
