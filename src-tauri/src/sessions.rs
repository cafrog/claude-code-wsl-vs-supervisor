use crate::types::{AppConfig, RawSession};
use std::path::PathBuf;

/// Read all session files from ~/.claude/sessions/*.json
/// Returns only sessions with a valid structure.
pub fn read_sessions(config: &AppConfig) -> Vec<RawSession> {
    let sessions_dir = PathBuf::from(&config.claude_dir).join("sessions");

    let entries = match std::fs::read_dir(&sessions_dir) {
        Ok(e) => e,
        Err(_) => return vec![],
    };

    let mut sessions = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let content = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        match serde_json::from_str::<RawSession>(&content) {
            Ok(session) => sessions.push(session),
            Err(_) => continue,
        }
    }

    sessions
}

/// Extract a short project name from a cwd path.
/// "/home/user/Projects/my-site.com" -> "my-site.com"
/// "/home/user/Projects/my-site.com/app.my-site.com" -> "app.my-site.com"
pub fn project_name_from_cwd(cwd: &str) -> String {
    cwd.rsplit('/').next().unwrap_or(cwd).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_project_name_simple() {
        assert_eq!(
            project_name_from_cwd("/home/user/Projects/my-site.com"),
            "my-site.com"
        );
    }

    #[test]
    fn test_project_name_nested() {
        assert_eq!(
            project_name_from_cwd("/home/user/Projects/my-site.com/app.my-site.com"),
            "app.my-site.com"
        );
    }

    #[test]
    fn test_project_name_no_slash() {
        assert_eq!(project_name_from_cwd("my-project"), "my-project");
    }
}
