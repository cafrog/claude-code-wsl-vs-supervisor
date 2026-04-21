export type AgentStatus = "thinking" | "coding" | "waiting";

export interface Agent {
  pid: number;
  sessionId: string;
  project: string;
  projectPath: string;
  startedAt: number;
  name: string | null;
  status: AgentStatus;
  lastMessage: string | null;
  lastMessageAt: number | null;
  lastResponse: string | null;
  lastResponseAt: number | null;
  lastActivity: number;
  cpu: number;
  memory: number;
}

export interface Project {
  name: string;
  path: string;
  agents: Agent[];
  vscodeWorkspace: string | null;
}

export interface DashboardState {
  projects: Project[];
  totalAgents: number;
}
