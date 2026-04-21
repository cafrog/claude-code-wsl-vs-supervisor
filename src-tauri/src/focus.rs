use crate::process_ext::hide_window;
use crate::types::AppConfig;
use std::process::Command;

/// Focus the VS Code window for the given project, then ask the companion
/// extension (running in WSL Remote inside that window) to focus the terminal
/// whose shell hosts the given PID.
#[tauri::command]
pub fn focus_agent(
    project_path: String,
    pid: u32,
    state: tauri::State<'_, crate::ConfigState>,
) -> Result<(), String> {
    let project_name = project_path
        .rsplit('/')
        .next()
        .unwrap_or(&project_path)
        .to_string();

    focus_vscode_window(&project_name)?;

    // Best-effort: ask the extension to switch to the right terminal.
    // If it fails we still succeeded at bringing the window forward.
    if let Some(config) = state.0.lock().ok().and_then(|c| c.clone()) {
        let _ = focus_terminal_via_extension(&config, &project_path, pid);
    }

    Ok(())
}

#[cfg(windows)]
fn focus_vscode_window(project_name: &str) -> Result<(), String> {
    use std::sync::Mutex;
    use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM, TRUE};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowTextW, IsIconic, IsWindowVisible, SetForegroundWindow,
        ShowWindow, SW_RESTORE,
    };

    struct SearchState {
        target: String,
        found: Option<isize>,
    }

    static SEARCH: std::sync::LazyLock<Mutex<SearchState>> =
        std::sync::LazyLock::new(|| {
            Mutex::new(SearchState {
                target: String::new(),
                found: None,
            })
        });

    {
        let mut state = SEARCH.lock().map_err(|e| e.to_string())?;
        state.target = project_name.to_lowercase();
        state.found = None;
    }

    unsafe extern "system" fn enum_callback(hwnd: HWND, _: LPARAM) -> BOOL {
        let mut title_buf = [0u16; 512];
        let len = GetWindowTextW(hwnd, title_buf.as_mut_ptr(), 512);
        if len == 0 || IsWindowVisible(hwnd) == 0 {
            return TRUE;
        }

        let title = String::from_utf16_lossy(&title_buf[..len as usize]).to_lowercase();

        if let Ok(mut state) = SEARCH.lock() {
            if title.contains(&state.target) && title.contains("visual studio code") {
                state.found = Some(hwnd as isize);
                return 0;
            }
        }
        TRUE
    }

    unsafe { EnumWindows(Some(enum_callback), 0) };

    let hwnd_raw = SEARCH
        .lock()
        .map_err(|e| e.to_string())?
        .found
        .ok_or_else(|| format!("VS Code window not found for: {}", project_name))?;

    let hwnd = hwnd_raw as HWND;

    unsafe {
        if IsIconic(hwnd) != 0 {
            ShowWindow(hwnd, SW_RESTORE);
        }
        SetForegroundWindow(hwnd);
    }

    Ok(())
}

#[cfg(not(windows))]
fn focus_vscode_window(_project_name: &str) -> Result<(), String> {
    Err("Window focus is only supported on Windows".to_string())
}

/// Ask every discovered helper extension (one per VS Code window) to focus
/// the right terminal. The one whose workspace contains the target PID wins.
fn focus_terminal_via_extension(
    config: &AppConfig,
    project_path: &str,
    pid: u32,
) -> Result<(), String> {
    let helpers = discover_helpers(config);
    if helpers.is_empty() {
        return Err("No helper extensions found".into());
    }

    // Prefer helpers whose workspace folders match the project path.
    let (matching, others): (Vec<_>, Vec<_>) = helpers
        .into_iter()
        .partition(|h| h.workspace_folders.iter().any(|f| f == project_path));

    let ordered = matching.into_iter().chain(others.into_iter());

    for helper in ordered {
        if post_focus(config, helper.port, pid) {
            return Ok(());
        }
    }
    Err("No helper terminal matched".into())
}

struct Helper {
    port: u16,
    workspace_folders: Vec<String>,
}

fn discover_helpers(config: &AppConfig) -> Vec<Helper> {
    let script = format!(
        r#"
DIR="/home/{user}/.claude-code-wsl-vs-supervisor/helpers"
[ -d "$DIR" ] || exit 0
for f in "$DIR"/*.json; do
  [ -f "$f" ] || continue
  PID=$(basename "$f" .json)
  # Skip stale files whose owning process is gone
  [ -d "/proc/$PID" ] || continue
  cat "$f"
  echo
done
"#,
        user = config.wsl_user
    );

    let output = hide_window(&mut Command::new("wsl.exe"))
        .args(["-d", &config.wsl_distro, "-e", "sh", "-c", &script])
        .output()
        .ok();

    let Some(output) = output else { return Vec::new() };
    let stdout = String::from_utf8_lossy(&output.stdout);

    stdout
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() {
                return None;
            }
            let v: serde_json::Value = serde_json::from_str(line).ok()?;
            let port = v.get("port").and_then(|p| p.as_u64())? as u16;
            let workspace_folders = v
                .get("workspaceFolders")
                .and_then(|w| w.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|e| e.as_str().map(|s| s.to_string()))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            Some(Helper {
                port,
                workspace_folders,
            })
        })
        .collect()
}

/// Send POST /focus?pid=<pid> to the helper through wsl.exe so the request
/// stays on the WSL loopback (where the extension listens). Returns true on
/// HTTP 200.
fn post_focus(config: &AppConfig, port: u16, pid: u32) -> bool {
    let url = format!("http://127.0.0.1:{}/focus?pid={}", port, pid);
    let output = hide_window(&mut Command::new("wsl.exe"))
        .args([
            "-d",
            &config.wsl_distro,
            "-e",
            "curl",
            "-sS",
            "-o",
            "/dev/null",
            "-w",
            "%{http_code}",
            "--max-time",
            "2",
            "-X",
            "POST",
            &url,
        ])
        .output();

    match output {
        Ok(o) => {
            let code = String::from_utf8_lossy(&o.stdout);
            code.trim() == "200"
        }
        Err(_) => false,
    }
}

/// Send a text message to the terminal hosting the given PID via the helper
/// extension. The text is passed as the request body so it can contain
/// newlines and special characters without shell-escaping issues.
#[tauri::command]
pub fn send_to_terminal(
    project_path: String,
    pid: u32,
    text: String,
    state: tauri::State<'_, crate::ConfigState>,
) -> Result<(), String> {
    let config = state
        .0
        .lock()
        .ok()
        .and_then(|c| c.clone())
        .ok_or_else(|| "No WSL configuration available".to_string())?;

    let helpers = discover_helpers(&config);
    if helpers.is_empty() {
        return Err("No helper extensions found".into());
    }

    let (matching, others): (Vec<_>, Vec<_>) = helpers
        .into_iter()
        .partition(|h| h.workspace_folders.iter().any(|f| f == &project_path));

    let ordered = matching.into_iter().chain(others.into_iter());

    for helper in ordered {
        if post_send(&config, helper.port, pid, &text) {
            return Ok(());
        }
    }
    Err("No helper terminal matched".into())
}

/// Post the message body to the helper's /send endpoint via wsl.exe curl.
fn post_send(config: &AppConfig, port: u16, pid: u32, text: &str) -> bool {
    let url = format!("http://127.0.0.1:{}/send?pid={}", port, pid);
    let mut child = match hide_window(&mut Command::new("wsl.exe"))
        .args([
            "-d",
            &config.wsl_distro,
            "-e",
            "curl",
            "-sS",
            "-o",
            "/dev/null",
            "-w",
            "%{http_code}",
            "--max-time",
            "3",
            "-X",
            "POST",
            "--data-binary",
            "@-",
            &url,
        ])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(_) => return false,
    };

    if let Some(mut stdin) = child.stdin.take() {
        use std::io::Write;
        let _ = stdin.write_all(text.as_bytes());
    }

    let output = match child.wait_with_output() {
        Ok(o) => o,
        Err(_) => return false,
    };

    let code = String::from_utf8_lossy(&output.stdout);
    code.trim() == "200"
}
