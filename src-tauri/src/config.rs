use crate::process_ext::hide_window;
use crate::types::AppConfig;
use std::path::PathBuf;
use std::process::Command;

/// Auto-detect WSL distro, user, and claude dir.
/// Returns None if no valid configuration found.
pub fn auto_detect() -> Option<AppConfig> {
    let distros = list_wsl_distros();
    for distro in &distros {
        if let Some(user) = find_claude_user(distro) {
            let claude_dir = format!(
                "\\\\wsl.localhost\\{}\\home\\{}\\.claude",
                distro, user
            );
            let test_path = format!("{}\\sessions", claude_dir);
            if PathBuf::from(&test_path).exists() {
                return Some(AppConfig {
                    wsl_distro: distro.clone(),
                    wsl_user: user,
                    claude_dir,
                });
            }
        }
    }
    None
}

/// List WSL distributions installed on the system.
fn list_wsl_distros() -> Vec<String> {
    let output = hide_window(&mut Command::new("wsl.exe"))
        .args(["-l", "-q"])
        .output()
        .ok();

    let Some(output) = output else { return vec![] };

    let text = decode_wsl_output(&output.stdout);

    text.lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect()
}

/// Decode wsl.exe output. It outputs UTF-16 LE on Windows by default,
/// but may output UTF-8 depending on how it's invoked. Try UTF-16 first
/// if the bytes look like UTF-16 (every other byte is null), otherwise UTF-8.
fn decode_wsl_output(bytes: &[u8]) -> String {
    // Heuristic: if more than half of the even-indexed bytes followed by
    // zero are ASCII, treat as UTF-16 LE.
    let looks_utf16 = bytes.len() >= 2
        && bytes.chunks_exact(2).take(10).all(|c| c[1] == 0);

    if looks_utf16 && bytes.len() % 2 == 0 {
        let u16_vec: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect();
        String::from_utf16_lossy(&u16_vec)
    } else {
        String::from_utf8_lossy(bytes).to_string()
    }
}

/// Find a user in the given distro that has a .claude directory.
fn find_claude_user(distro: &str) -> Option<String> {
    let home_path = format!("\\\\wsl.localhost\\{}\\home", distro);
    let home_dir = PathBuf::from(&home_path);

    if !home_dir.exists() {
        return None;
    }

    let entries = std::fs::read_dir(&home_dir).ok()?;
    for entry in entries.flatten() {
        let user_name = entry.file_name().to_string_lossy().to_string();
        let claude_path = entry.path().join(".claude").join("sessions");
        if claude_path.exists() {
            return Some(user_name);
        }
    }
    None
}

/// Load config from %APPDATA%\claude-code-wsl-vs-supervisor\config.json
pub fn load_config() -> Option<AppConfig> {
    let path = config_path()?;
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

/// Save config to %APPDATA%\claude-code-wsl-vs-supervisor\config.json
pub fn save_config(config: &AppConfig) -> Result<(), String> {
    let path = config_path().ok_or("Could not determine config path")?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    std::fs::write(path, content).map_err(|e| e.to_string())
}

fn config_path() -> Option<PathBuf> {
    let appdata = std::env::var("APPDATA").ok()?;
    Some(PathBuf::from(appdata).join("claude-code-wsl-vs-supervisor").join("config.json"))
}

/// Initialize config: load saved config, or auto-detect, or return None.
pub fn init_config() -> Option<AppConfig> {
    if let Some(config) = load_config() {
        // Verify saved config is still valid
        let test_path = format!("{}\\sessions", config.claude_dir);
        if PathBuf::from(&test_path).exists() {
            return Some(config);
        }
    }
    let config = auto_detect()?;
    let _ = save_config(&config);
    Some(config)
}
