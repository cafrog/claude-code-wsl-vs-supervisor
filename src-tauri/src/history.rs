use crate::types::AppConfig;
use serde::Serialize;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::PathBuf;

/// A single conversation entry (user or assistant) in chronological order.
/// Used by the chat panel to display the full visible history.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationEntry {
    pub role: &'static str, // "user" | "assistant"
    pub text: String,
    /// Unix millis if the source line has a timestamp, else 0 (for last-prompt
    /// entries whose order is preserved by file position).
    pub timestamp: u64,
    pub order: u64,
}

/// A message with its synthetic ordering value.
/// - `order` is the file position (monotonically increasing) used to compare
///   message recency within the same session. Real timestamps are preferred
///   when available, but `order` guarantees chronological comparison even
///   without them (e.g. for `last-prompt` entries).
/// - `timestamp` is the Unix millis if the source line has one, else 0.
#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct TimedMessage {
    pub text: String,
    pub timestamp: u64,
    pub order: u64,
}

/// The most recent user input and assistant response from a session log.
#[derive(Debug, Clone, Default)]
pub struct LastExchange {
    pub user_message: Option<TimedMessage>,
    pub assistant_response: Option<TimedMessage>,
}

/// Encode a cwd path to Claude Code's project directory format.
pub fn encode_project_path(cwd: &str) -> String {
    cwd.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

/// Read the session's conversation log and extract the most recent user
/// message and assistant response. Uses the per-session `projects/<enc>/<id>.jsonl`
/// file which is updated immediately when the user submits a prompt.
pub fn read_last_exchange(
    config: &AppConfig,
    cwd: &str,
    session_id: &str,
    tail_bytes: u64,
) -> LastExchange {
    let encoded = encode_project_path(cwd);
    let path = PathBuf::from(&config.claude_dir)
        .join("projects")
        .join(&encoded)
        .join(format!("{}.jsonl", session_id));

    let file = match std::fs::File::open(&path) {
        Ok(f) => f,
        Err(_) => return LastExchange::default(),
    };

    let file_len = file.metadata().map(|m| m.len()).unwrap_or(0);
    let start_pos = file_len.saturating_sub(tail_bytes);

    let mut reader = BufReader::new(file);
    if reader.seek(SeekFrom::Start(start_pos)).is_err() {
        return LastExchange::default();
    }

    if start_pos > 0 {
        let mut discard = String::new();
        let _ = reader.read_line(&mut discard);
    }

    let mut result = LastExchange::default();
    let mut line_idx: u64 = start_pos;

    for line in reader.lines().map_while(Result::ok) {
        line_idx += 1;
        if line.is_empty() {
            continue;
        }
        let val: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let entry_type = val.get("type").and_then(|v| v.as_str()).unwrap_or("");

        match entry_type {
            "last-prompt" => {
                if let Some(prompt) = val.get("lastPrompt").and_then(|v| v.as_str()) {
                    let trimmed = prompt.trim();
                    if !trimmed.is_empty() {
                        result.user_message = Some(TimedMessage {
                            text: trimmed.to_string(),
                            timestamp: 0,
                            order: line_idx,
                        });
                    }
                }
            }
            "user" => {
                if let Some(text) = extract_user_text(&val) {
                    let timestamp = parse_timestamp(&val);
                    result.user_message = Some(TimedMessage {
                        text,
                        timestamp,
                        order: line_idx,
                    });
                }
            }
            "assistant" => {
                if let Some(text) = extract_assistant_text(&val) {
                    let timestamp = parse_timestamp(&val);
                    result.assistant_response = Some(TimedMessage {
                        text,
                        timestamp,
                        order: line_idx,
                    });
                }
            }
            _ => {}
        }
    }

    result
}

/// Read the full visible conversation from a session log — all user messages
/// and assistant text responses in chronological order, up to `tail_bytes`
/// from the end of the file. The chat panel uses this to show scrollable
/// history instead of just the last exchange.
pub fn read_conversation(
    config: &AppConfig,
    cwd: &str,
    session_id: &str,
    tail_bytes: u64,
) -> Vec<ConversationEntry> {
    let encoded = encode_project_path(cwd);
    let path = PathBuf::from(&config.claude_dir)
        .join("projects")
        .join(&encoded)
        .join(format!("{}.jsonl", session_id));

    let file = match std::fs::File::open(&path) {
        Ok(f) => f,
        Err(_) => return Vec::new(),
    };

    let file_len = file.metadata().map(|m| m.len()).unwrap_or(0);
    let start_pos = file_len.saturating_sub(tail_bytes);

    let mut reader = BufReader::new(file);
    if reader.seek(SeekFrom::Start(start_pos)).is_err() {
        return Vec::new();
    }
    if start_pos > 0 {
        let mut discard = String::new();
        let _ = reader.read_line(&mut discard);
    }

    let mut entries: Vec<ConversationEntry> = Vec::new();
    let mut line_idx: u64 = start_pos;
    // Track the most recent pending `last-prompt` so we don't duplicate it
    // with the matching `type:user` entry that usually follows.
    let mut pending_prompt: Option<(String, u64)> = None;

    for line in reader.lines().map_while(Result::ok) {
        line_idx += 1;
        if line.is_empty() {
            continue;
        }
        let val: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let entry_type = val.get("type").and_then(|v| v.as_str()).unwrap_or("");

        match entry_type {
            "last-prompt" => {
                if let Some(prompt) = val.get("lastPrompt").and_then(|v| v.as_str()) {
                    let trimmed = prompt.trim().to_string();
                    if !trimmed.is_empty() {
                        pending_prompt = Some((trimmed, line_idx));
                    }
                }
            }
            "user" => {
                if let Some(text) = extract_user_text(&val) {
                    let ts = parse_timestamp(&val);
                    // If this user entry matches the pending last-prompt, the
                    // prompt has been "confirmed" — skip the synthetic one.
                    if let Some((p, _)) = &pending_prompt {
                        if p == &text {
                            pending_prompt = None;
                        }
                    }
                    entries.push(ConversationEntry {
                        role: "user",
                        text,
                        timestamp: ts,
                        order: line_idx,
                    });
                }
            }
            "assistant" => {
                if let Some(text) = extract_assistant_text(&val) {
                    let ts = parse_timestamp(&val);
                    entries.push(ConversationEntry {
                        role: "assistant",
                        text,
                        timestamp: ts,
                        order: line_idx,
                    });
                }
            }
            _ => {}
        }
    }

    // If there's still an unmatched last-prompt (user submitted but their
    // full "user" entry hasn't been logged yet), append it as a user message.
    if let Some((p, order)) = pending_prompt {
        entries.push(ConversationEntry {
            role: "user",
            text: p,
            timestamp: 0,
            order,
        });
    }

    entries
}

/// Extract a plain-text user message from a `type: "user"` entry.
/// Returns None for tool_result entries (those aren't real user input).
/// Also filters out Claude Code's synthetic user messages wrapped in
/// `<task-notification>`, `<system-reminder>`, `<command-name>`, etc.
fn extract_user_text(val: &serde_json::Value) -> Option<String> {
    let content = val.pointer("/message/content")?;

    let raw = if let Some(s) = content.as_str() {
        s.to_string()
    } else {
        let blocks = content.as_array()?;
        let mut out = String::new();
        let mut has_tool_result = false;
        for block in blocks {
            let block_type = block.get("type").and_then(|v| v.as_str()).unwrap_or("");
            if block_type == "tool_result" {
                has_tool_result = true;
                continue;
            }
            if block_type == "text" {
                if let Some(t) = block.get("text").and_then(|v| v.as_str()) {
                    if !out.is_empty() {
                        out.push('\n');
                    }
                    out.push_str(t);
                }
            }
        }
        if out.trim().is_empty() && has_tool_result {
            return None;
        }
        out
    };

    let cleaned = strip_system_tags(&raw);
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Remove Claude Code system-generated wrapper tags from a user message.
/// These appear as `<task-notification>…</task-notification>`,
/// `<system-reminder>…</system-reminder>`, `<command-name>…</command-name>`,
/// `<command-output>…</command-output>` and similar. If a message consists
/// entirely of such tags, the cleaned version is empty so the caller skips it.
fn strip_system_tags(input: &str) -> String {
    const TAGS: &[&str] = &[
        "task-notification",
        "system-reminder",
        "command-name",
        "command-message",
        "command-args",
        "command-output",
        "local-command-stdout",
        "local-command-stderr",
    ];
    let mut out = input.to_string();
    for tag in TAGS {
        let open = format!("<{}>", tag);
        let close = format!("</{}>", tag);
        loop {
            let Some(start) = out.find(&open) else { break };
            let Some(end) = out[start..].find(&close) else { break };
            let end_abs = start + end + close.len();
            out.replace_range(start..end_abs, "");
        }
    }
    out
}

/// Extract the text content from an assistant entry, ignoring tool_use blocks.
fn extract_assistant_text(val: &serde_json::Value) -> Option<String> {
    let blocks = val.pointer("/message/content")?.as_array()?;
    let mut out = String::new();
    for block in blocks {
        if block.get("type").and_then(|v| v.as_str()) == Some("text") {
            if let Some(t) = block.get("text").and_then(|v| v.as_str()) {
                if !out.is_empty() {
                    out.push('\n');
                }
                out.push_str(t);
            }
        }
    }
    let trimmed = out.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn parse_timestamp(val: &serde_json::Value) -> u64 {
    val.get("timestamp")
        .and_then(|v| v.as_str())
        .and_then(parse_iso_millis)
        .unwrap_or(0)
}

fn parse_iso_millis(s: &str) -> Option<u64> {
    let bytes = s.as_bytes();
    if bytes.len() < 20 || bytes[4] != b'-' || bytes[7] != b'-' || bytes[10] != b'T' {
        return None;
    }
    let year: i64 = s.get(0..4)?.parse().ok()?;
    let month: i64 = s.get(5..7)?.parse().ok()?;
    let day: i64 = s.get(8..10)?.parse().ok()?;
    let hour: i64 = s.get(11..13)?.parse().ok()?;
    let minute: i64 = s.get(14..16)?.parse().ok()?;
    let second: i64 = s.get(17..19)?.parse().ok()?;

    let millis: i64 = if bytes.len() > 20 && bytes[19] == b'.' {
        let end = s[20..].find(|c: char| !c.is_ascii_digit()).unwrap_or(s.len() - 20);
        let frac = s.get(20..20 + end)?;
        let frac_padded = format!("{:0<3.3}", frac);
        frac_padded.parse().ok()?
    } else {
        0
    };

    let days = days_from_epoch(year, month, day)?;
    let total_secs = days * 86400 + hour * 3600 + minute * 60 + second;
    Some((total_secs * 1000 + millis) as u64)
}

fn days_from_epoch(y: i64, m: i64, d: i64) -> Option<i64> {
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    let is_leap = |y: i64| (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let month_days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut days: i64 = 0;
    for year in 1970..y {
        days += if is_leap(year) { 366 } else { 365 };
    }
    for i in 0..(m - 1) as usize {
        days += month_days[i] as i64;
        if i == 1 && is_leap(y) {
            days += 1;
        }
    }
    days += d - 1;
    Some(days)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encode_project_path_simple() {
        assert_eq!(
            encode_project_path("/home/user/Projects/my-project"),
            "-home-user-Projects-my-project"
        );
    }

    #[test]
    fn test_encode_project_path_with_dots() {
        assert_eq!(
            encode_project_path("/home/user/Projects/sub.example.com"),
            "-home-user-Projects-sub-example-com"
        );
    }

    #[test]
    fn test_extract_user_text_string() {
        let val: serde_json::Value =
            serde_json::from_str(r#"{"type":"user","message":{"content":"hello"}}"#).unwrap();
        assert_eq!(extract_user_text(&val), Some("hello".to_string()));
    }

    #[test]
    fn test_extract_user_text_ignores_tool_result() {
        let val: serde_json::Value = serde_json::from_str(
            r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"x","content":"output"}]}}"#,
        )
        .unwrap();
        assert_eq!(extract_user_text(&val), None);
    }

    #[test]
    fn test_extract_assistant_text_ignores_tool_use() {
        let val: serde_json::Value = serde_json::from_str(
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"x","name":"Bash","input":{}},{"type":"text","text":"Done."}]}}"#,
        )
        .unwrap();
        assert_eq!(extract_assistant_text(&val), Some("Done.".to_string()));
    }

    #[test]
    fn test_parse_iso_millis_basic() {
        let t = parse_iso_millis("2026-04-17T10:51:13.557Z").unwrap();
        assert!(t > 1_700_000_000_000);
        assert!(t < 2_000_000_000_000);
    }
}
