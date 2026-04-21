use crate::types::{AppConfig, RawIdeLock};
use std::collections::HashMap;
use std::path::PathBuf;

/// Read all ide/*.lock files and build a mapping of
/// workspace folder path -> RawIdeLock entry.
/// This lets us match a session's cwd to a VS Code window.
pub fn read_ide_locks(config: &AppConfig) -> HashMap<String, RawIdeLock> {
    let ide_dir = PathBuf::from(&config.claude_dir).join("ide");

    let entries = match std::fs::read_dir(&ide_dir) {
        Ok(e) => e,
        Err(_) => return HashMap::new(),
    };

    let mut mapping: HashMap<String, RawIdeLock> = HashMap::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("lock") {
            continue;
        }
        let content = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        // IDE lock files can contain multiple JSON objects concatenated.
        // Each is a separate entry, not separated by newlines.
        let json_strs = split_concatenated_json(&content);
        for json_str in json_strs {
            if let Ok(lock) = serde_json::from_str::<RawIdeLock>(&json_str) {
                for folder in &lock.workspace_folders {
                    mapping.insert(folder.clone(), lock.clone());
                }
            }
        }
    }

    mapping
}

/// Split concatenated JSON objects like `{"a":1}{"b":2}` into separate strings.
fn split_concatenated_json(input: &str) -> Vec<String> {
    let mut results = Vec::new();
    let mut depth = 0i32;
    let mut start = None;
    let mut in_string = false;
    let mut escape_next = false;

    for (i, ch) in input.char_indices() {
        if escape_next {
            escape_next = false;
            continue;
        }
        if ch == '\\' && in_string {
            escape_next = true;
            continue;
        }
        if ch == '"' {
            in_string = !in_string;
            continue;
        }
        if in_string {
            continue;
        }
        if ch == '{' {
            if depth == 0 {
                start = Some(i);
            }
            depth += 1;
        } else if ch == '}' {
            depth -= 1;
            if depth == 0 {
                if let Some(s) = start {
                    results.push(input[s..=i].to_string());
                }
                start = None;
            }
        }
    }

    results
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_split_single_json() {
        let input = r#"{"pid":1415,"workspaceFolders":["/home/user/Projects/test"]}"#;
        let result = split_concatenated_json(input);
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn test_split_concatenated_json() {
        let input = r#"{"a":1}{"b":2}{"c":3}"#;
        let result = split_concatenated_json(input);
        assert_eq!(result.len(), 3);
        assert_eq!(result[0], r#"{"a":1}"#);
        assert_eq!(result[1], r#"{"b":2}"#);
        assert_eq!(result[2], r#"{"c":3}"#);
    }

    #[test]
    fn test_split_json_with_nested_braces() {
        let input = r#"{"a":{"b":1}}{"c":2}"#;
        let result = split_concatenated_json(input);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0], r#"{"a":{"b":1}}"#);
    }

    #[test]
    fn test_split_json_with_braces_in_strings() {
        let input = r#"{"a":"hello{world}"}{"b":1}"#;
        let result = split_concatenated_json(input);
        assert_eq!(result.len(), 2);
    }
}
