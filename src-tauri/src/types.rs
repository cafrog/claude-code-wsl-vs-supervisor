use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AgentStatus {
    Thinking,
    Coding,
    Waiting,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Agent {
    pub pid: u32,
    pub session_id: String,
    pub project: String,
    pub project_path: String,
    pub started_at: u64,
    pub name: Option<String>,
    pub status: AgentStatus,
    pub last_message: Option<String>,
    pub last_message_at: Option<u64>,
    pub last_response: Option<String>,
    pub last_response_at: Option<u64>,
    pub last_activity: u64,
    pub cpu: f32,
    pub memory: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub name: String,
    pub path: String,
    pub agents: Vec<Agent>,
    pub vscode_workspace: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub wsl_distro: String,
    pub wsl_user: String,
    pub claude_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardState {
    pub projects: Vec<Project>,
    pub total_agents: usize,
}

/// Raw session data from sessions/*.json. Fields are read via serde even if
/// Rust doesn't access them directly.
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawSession {
    pub pid: u32,
    pub session_id: String,
    pub cwd: String,
    pub started_at: u64,
    pub name: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
}

/// Raw history entry from history.jsonl
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawHistoryEntry {
    pub display: String,
    pub timestamp: u64,
    pub session_id: String,
}

/// Raw IDE lock entry from ide/*.lock
#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawIdeLock {
    pub pid: u32,
    pub workspace_folders: Vec<String>,
    pub ide_name: Option<String>,
}

/// Process info from ps aux
#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct ProcessInfo {
    pub pid: u32,
    pub cpu: f32,
    pub memory: f32,
}

/// Status signals collected from /proc
#[derive(Debug, Clone, Default)]
pub struct StatusSignals {
    pub has_https_connection: bool,
    pub io_read_bytes: u64,
    pub io_write_bytes: u64,
    pub child_count: u32,
    /// Cumulative CPU ticks (utime + stime) from /proc/<pid>/stat.
    /// Use the delta between polls to detect CPU activity.
    pub cpu_ticks: u64,
}
