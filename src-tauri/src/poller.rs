use crate::config;
use crate::history;
use crate::ide;
use crate::sessions;
use crate::status;
use crate::types::{Agent, AppConfig, DashboardState, Project, RawSession};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// Shared state that persists between polls.
pub struct PollerState {
    pub previous_io: HashMap<u32, (u64, u64)>,
    pub config: Option<AppConfig>,
    /// sessionId -> (message text, first-seen timestamp in ms)
    pub user_first_seen: HashMap<String, (String, u64)>,
    /// sessionId -> (response text, first-seen timestamp in ms)
    pub assistant_first_seen: HashMap<String, (String, u64)>,
    /// pid -> previous poll's cumulative CPU ticks
    pub previous_cpu_ticks: HashMap<u32, u64>,
}

/// Start the background polling loop.
pub fn start_polling(app: AppHandle) {
    let state = Arc::new(Mutex::new(PollerState {
        previous_io: HashMap::new(),
        config: config::init_config(),
        user_first_seen: HashMap::new(),
        assistant_first_seen: HashMap::new(),
        previous_cpu_ticks: HashMap::new(),
    }));

    std::thread::spawn(move || {
        loop {
            let dashboard = {
                let mut state = state.lock().unwrap();
                if let Some(ref config) = state.config {
                    let cfg = config.clone();
                    Some(poll_once(&cfg, &mut state))
                } else {
                    state.config = config::init_config();
                    None
                }
            };

            if let Some(dashboard) = dashboard {
                let _ = app.emit("agents-update", &dashboard);
            }

            std::thread::sleep(Duration::from_millis(2500));
        }
    });
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Resolve the current sessionId for each running PID in a project.
///
/// Claude Code does NOT update `sessions/<PID>.json` when the user runs
/// `/clear` — the file keeps pointing at the original sessionId while the
/// process silently switches to a new conversation log. We detect this by
/// inspecting the mtimes of all `.jsonl` files in the project directory and
/// assigning each running PID the most recent unclaimed log.
fn resolve_current_sessions(
    config: &AppConfig,
    sessions_in_project: &[&RawSession],
) -> HashMap<u32, String> {
    if sessions_in_project.is_empty() {
        return HashMap::new();
    }

    let cwd = &sessions_in_project[0].cwd;
    let encoded = history::encode_project_path(cwd);
    let dir = PathBuf::from(&config.claude_dir).join("projects").join(&encoded);

    // Gather all jsonl files with their mtimes, sorted newest-first.
    let mut candidates: Vec<(String, u64)> = match std::fs::read_dir(&dir) {
        Ok(entries) => entries
            .flatten()
            .filter_map(|e| {
                let path = e.path();
                if path.extension().and_then(|s| s.to_str()) != Some("jsonl") {
                    return None;
                }
                let sid = path.file_stem()?.to_string_lossy().to_string();
                let mtime = e
                    .metadata()
                    .ok()?
                    .modified()
                    .ok()?
                    .duration_since(std::time::UNIX_EPOCH)
                    .ok()?
                    .as_secs();
                Some((sid, mtime))
            })
            .collect(),
        Err(_) => Vec::new(),
    };
    candidates.sort_by(|a, b| b.1.cmp(&a.1));

    let pid_count = sessions_in_project.len();
    let top_sids: std::collections::HashSet<&String> = candidates
        .iter()
        .take(pid_count)
        .map(|(sid, _)| sid)
        .collect();

    let mut assigned: HashMap<u32, String> = HashMap::new();
    let mut used_sids: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut unassigned_pids: Vec<&RawSession> = Vec::new();

    // Phase 1: honor the sessions-file assignment if its sessionId is among
    // the most-recently-active logs — this keeps stable attribution when no
    // /clear happened.
    for s in sessions_in_project {
        if top_sids.contains(&s.session_id) && !used_sids.contains(&s.session_id) {
            assigned.insert(s.pid, s.session_id.clone());
            used_sids.insert(s.session_id.clone());
        } else {
            unassigned_pids.push(s);
        }
    }

    // Phase 2: for PIDs whose stored sessionId is stale (i.e. not in the top N),
    // assign the newest unclaimed log. This catches /clear.
    for (sid, _) in &candidates {
        if unassigned_pids.is_empty() {
            break;
        }
        if used_sids.contains(sid) {
            continue;
        }
        let pid_session = unassigned_pids.remove(0);
        assigned.insert(pid_session.pid, sid.clone());
        used_sids.insert(sid.clone());
    }

    // Phase 3: any PID still unassigned (more PIDs than logs) falls back to
    // the sessionId from its sessions file.
    for s in unassigned_pids {
        assigned.insert(s.pid, s.session_id.clone());
    }

    assigned
}

/// Resolve the display timestamp for a message: real timestamp if present,
/// else the time we first saw this exact text for the session.
fn resolve_ts(
    cache: &mut HashMap<String, (String, u64)>,
    session_id: &str,
    text: &str,
    real_ts: u64,
    now: u64,
) -> u64 {
    if real_ts > 0 {
        return real_ts;
    }
    match cache.get(session_id) {
        Some((prev_text, prev_ts)) if prev_text == text => *prev_ts,
        _ => {
            cache.insert(session_id.to_string(), (text.to_string(), now));
            now
        }
    }
}

/// Single poll: read all sources and build the dashboard state.
fn poll_once(config: &AppConfig, state: &mut PollerState) -> DashboardState {
    let previous_io = &mut state.previous_io;
    let user_first_seen = &mut state.user_first_seen;
    let assistant_first_seen = &mut state.assistant_first_seen;
    let previous_cpu_ticks = &mut state.previous_cpu_ticks;
    // 1. Read session files
    let raw_sessions = sessions::read_sessions(config);

    // 2. Collect PIDs
    let pids: Vec<u32> = raw_sessions.iter().map(|s| s.pid).collect();

    // 3. Get process data from WSL (single call)
    let (processes, signals) = status::collect_process_data(config, &pids);

    // 4. Resolve the CURRENT sessionId for each running PID. The sessions/
    //    file becomes stale after /clear, so we cross-reference with log mtimes.
    let alive_sessions: Vec<&RawSession> = raw_sessions
        .iter()
        .filter(|s| processes.contains_key(&s.pid))
        .collect();

    // Group alive sessions by cwd, then resolve current sessionId per project.
    let mut sessions_by_cwd: HashMap<String, Vec<&RawSession>> = HashMap::new();
    for s in &alive_sessions {
        sessions_by_cwd.entry(s.cwd.clone()).or_default().push(s);
    }
    let mut current_session_by_pid: HashMap<u32, String> = HashMap::new();
    for (_cwd, list) in &sessions_by_cwd {
        let resolved = resolve_current_sessions(config, list);
        for (pid, sid) in resolved {
            current_session_by_pid.insert(pid, sid);
        }
    }

    // 5. Read IDE locks
    let ide_locks = ide::read_ide_locks(config);

    // 6. Build agents, filtering out dead processes
    let mut project_map: HashMap<String, Vec<Agent>> = HashMap::new();

    for session in &raw_sessions {
        // Skip dead processes
        let process = match processes.get(&session.pid) {
            Some(p) => p,
            None => continue,
        };

        let project_name = sessions::project_name_from_cwd(&session.cwd);
        let agent_signals = signals.get(&session.pid);
        let prev_io = previous_io.get(&session.pid);
        let now = now_ms();

        let current_session_id = current_session_by_pid
            .get(&session.pid)
            .cloned()
            .unwrap_or_else(|| session.session_id.clone());

        let exchange =
            history::read_last_exchange(config, &session.cwd, &current_session_id, 512_000);
        let user_msg = exchange.user_message.as_ref();
        let assistant_msg = exchange.assistant_response.as_ref();

        // Key caches by the CURRENT sessionId so /clear creates a fresh
        // "first-seen" timestamp for the new conversation.
        let user_ts = user_msg.map(|m| {
            resolve_ts(
                user_first_seen,
                &current_session_id,
                &m.text,
                m.timestamp,
                now,
            )
        });
        let assistant_ts = assistant_msg.map(|m| {
            resolve_ts(
                assistant_first_seen,
                &current_session_id,
                &m.text,
                m.timestamp,
                now,
            )
        });

        // A message that hasn't been answered yet within a reasonable window
        // is a hint that the agent just started working — the I/O / CPU
        // detection can lag by one poll after submit. After this window we
        // trust the detection so agents whose response we never catch don't
        // stay stuck on "thinking" forever.
        const RECENT_WINDOW_MS: u64 = 60_000;
        let recent_pending = match (user_ts, assistant_ts) {
            (Some(u), None) => now.saturating_sub(u) < RECENT_WINDOW_MS,
            (Some(u), Some(a)) => u > a && now.saturating_sub(u) < RECENT_WINDOW_MS,
            _ => false,
        };

        let prev_cpu = previous_cpu_ticks.get(&session.pid).copied();

        let detected_status = match agent_signals {
            Some(s) => status::determine_status(s, prev_io, prev_cpu),
            None => crate::types::AgentStatus::Waiting,
        };

        let agent_status =
            if recent_pending && detected_status == crate::types::AgentStatus::Waiting {
                crate::types::AgentStatus::Thinking
            } else {
                detected_status
            };

        if let Some(s) = agent_signals {
            previous_io.insert(session.pid, (s.io_read_bytes, s.io_write_bytes));
            previous_cpu_ticks.insert(session.pid, s.cpu_ticks);
        }

        let agent = Agent {
            pid: session.pid,
            session_id: current_session_id,
            project: project_name.clone(),
            project_path: session.cwd.clone(),
            started_at: session.started_at,
            name: session.name.clone(),
            status: agent_status,
            last_message: user_msg.map(|m| m.text.clone()),
            last_message_at: user_ts,
            last_response: assistant_msg.map(|m| m.text.clone()),
            last_response_at: assistant_ts,
            last_activity: now,
            cpu: process.cpu,
            memory: process.memory,
        };

        project_map.entry(project_name).or_default().push(agent);
    }

    // Clean up per-pid state for dead PIDs
    previous_io.retain(|pid, _| processes.contains_key(pid));
    previous_cpu_ticks.retain(|pid, _| processes.contains_key(pid));

    // 7. Build projects
    let mut projects: Vec<Project> = project_map
        .into_iter()
        .map(|(name, mut agents)| {
            // Sort agents by session start time so the order matches the order
            // terminals were opened in VS Code (users typically open terminals
            // sequentially and start `claude` in each right away).
            agents.sort_by_key(|a| a.started_at);
            let path = agents.first().map(|a| a.project_path.clone()).unwrap_or_default();
            let vscode_workspace = ide_locks.get(&path).and_then(|lock| {
                lock.workspace_folders.first().cloned()
            });
            Project {
                name,
                path,
                agents,
                vscode_workspace,
            }
        })
        .collect();

    // Sort projects by name for stable ordering
    projects.sort_by(|a, b| a.name.cmp(&b.name));

    let total_agents = projects.iter().map(|p| p.agents.len()).sum();

    DashboardState {
        projects,
        total_agents,
    }
}
