use crate::process_ext::hide_window;
use crate::types::{AgentStatus, AppConfig, ProcessInfo, StatusSignals};
use std::collections::HashMap;
use std::process::Command;

/// Collect all process-level data in a single wsl.exe call.
/// Returns (process_info, status_signals) for each PID found alive.
pub fn collect_process_data(
    config: &AppConfig,
    pids: &[u32],
) -> (HashMap<u32, ProcessInfo>, HashMap<u32, StatusSignals>) {
    if pids.is_empty() {
        return (HashMap::new(), HashMap::new());
    }

    let pid_list = pids.iter().map(|p| p.to_string()).collect::<Vec<_>>().join(" ");

    // Single wsl.exe call that collects: ps info, net/tcp, io, children, CPU ticks.
    // CPU ticks (utime+stime from /proc/<pid>/stat) are the most reliable signal
    // for "is the process doing work right now" — idle Node.js uses near zero,
    // active work uses tens to hundreds per 2.5s poll.
    let script = format!(
        r#"
for PID in {pid_list}; do
  if [ -d /proc/$PID ]; then
    PS_LINE=$(ps -p $PID -o pid=,pcpu=,pmem= 2>/dev/null | tail -1)
    if [ -n "$PS_LINE" ]; then
      echo "PS:$PS_LINE"
    fi
    HTTPS=$(cat /proc/$PID/net/tcp 2>/dev/null | grep -c ":01BB" || echo 0)
    echo "NET:$PID:$HTTPS"
    if [ -f /proc/$PID/io ]; then
      READ=$(grep "^rchar:" /proc/$PID/io 2>/dev/null | awk '{{print $2}}')
      WRITE=$(grep "^wchar:" /proc/$PID/io 2>/dev/null | awk '{{print $2}}')
      echo "IO:$PID:${{READ:-0}}:${{WRITE:-0}}"
    fi
    # CPU ticks: read /proc/<pid>/stat, skip up to last ')', then fields 12+13
    # (utime and stime) give total ticks consumed by the process.
    STAT_LINE=$(cat /proc/$PID/stat 2>/dev/null)
    if [ -n "$STAT_LINE" ]; then
      REST=${{STAT_LINE##*)}}
      TICKS=$(echo "$REST" | awk '{{print $12+$13}}')
      echo "CPU:$PID:${{TICKS:-0}}"
    fi
    # Count only FOREGROUND shell children — those are the processes spawned
    # by a synchronous Bash tool. Background subagents (Task tool) also spawn
    # shells but redirect stdout to /tmp/claude-*/tasks/*.output, and the main
    # agent is free to accept user input while they run. We ignore those.
    SHELL_COUNT=0
    for CHILD in $(pgrep -P $PID 2>/dev/null); do
      COMM=$(cat /proc/$CHILD/comm 2>/dev/null || echo "")
      case "$COMM" in
        bash|sh|zsh|dash|fish|ksh|ash) ;;
        *) continue;;
      esac
      STDOUT=$(readlink /proc/$CHILD/fd/1 2>/dev/null || echo "")
      case "$STDOUT" in
        /tmp/claude-*/tasks/*) ;; # background subagent — skip
        *) SHELL_COUNT=$((SHELL_COUNT + 1));;
      esac
    done
    echo "CHILDREN:$PID:$SHELL_COUNT"
  fi
done
"#
    );

    let output = hide_window(&mut Command::new("wsl.exe"))
        .args(["-d", &config.wsl_distro, "-e", "sh", "-c", &script])
        .output();

    let output = match output {
        Ok(o) => o,
        Err(_) => return (HashMap::new(), HashMap::new()),
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_process_output(&stdout)
}

fn parse_process_output(
    output: &str,
) -> (HashMap<u32, ProcessInfo>, HashMap<u32, StatusSignals>) {
    let mut processes: HashMap<u32, ProcessInfo> = HashMap::new();
    let mut signals: HashMap<u32, StatusSignals> = HashMap::new();

    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        if let Some(rest) = line.strip_prefix("PS:") {
            let parts: Vec<&str> = rest.split_whitespace().collect();
            if parts.len() >= 3 {
                if let (Ok(pid), Ok(cpu), Ok(mem)) = (
                    parts[0].parse::<u32>(),
                    parts[1].parse::<f32>(),
                    parts[2].parse::<f32>(),
                ) {
                    processes.insert(pid, ProcessInfo { pid, cpu, memory: mem });
                }
            }
        } else if let Some(rest) = line.strip_prefix("NET:") {
            let parts: Vec<&str> = rest.split(':').collect();
            if parts.len() >= 2 {
                if let (Ok(pid), Ok(count)) = (
                    parts[0].parse::<u32>(),
                    parts[1].parse::<u32>(),
                ) {
                    signals.entry(pid).or_default().has_https_connection = count > 0;
                }
            }
        } else if let Some(rest) = line.strip_prefix("IO:") {
            let parts: Vec<&str> = rest.split(':').collect();
            if parts.len() >= 3 {
                if let (Ok(pid), Ok(read), Ok(write)) = (
                    parts[0].parse::<u32>(),
                    parts[1].parse::<u64>(),
                    parts[2].parse::<u64>(),
                ) {
                    let entry = signals.entry(pid).or_default();
                    entry.io_read_bytes = read;
                    entry.io_write_bytes = write;
                }
            }
        } else if let Some(rest) = line.strip_prefix("CHILDREN:") {
            let parts: Vec<&str> = rest.split(':').collect();
            if parts.len() >= 2 {
                if let (Ok(pid), Ok(count)) = (
                    parts[0].parse::<u32>(),
                    parts[1].parse::<u32>(),
                ) {
                    signals.entry(pid).or_default().child_count = count;
                }
            }
        } else if let Some(rest) = line.strip_prefix("CPU:") {
            let parts: Vec<&str> = rest.split(':').collect();
            if parts.len() >= 2 {
                if let (Ok(pid), Ok(ticks)) = (
                    parts[0].parse::<u32>(),
                    parts[1].parse::<u64>(),
                ) {
                    signals.entry(pid).or_default().cpu_ticks = ticks;
                }
            }
        }
    }

    (processes, signals)
}

/// CPU tick delta (per 2.5s poll) above which the process is considered active.
/// Linux defaults to 100 Hz USER_HZ, so 10 ticks = 100 ms of CPU = ~4% over a
/// 2.5s window. Idle Node.js with TUI render uses < 5 ticks per poll.
const CPU_ACTIVE_TICKS: u64 = 10;

/// rchar delta above which we consider the agent is receiving an API stream.
/// Calibrated from observation of idle baseline (< 5 KB) vs active stream
/// (tens of KB per 2.5s).
const THINK_RCHAR_BYTES: u64 = 12_288;

/// Determine agent status from current signals and previous samples.
///
/// Signal priority:
/// 1. Shell children (bash/sh etc.) → the Bash tool is running → coding
/// 2. CPU is active AND significant network read → thinking (API streaming)
/// 3. CPU is active → coding (internal tools like Edit/Read, or post-stream work)
/// 4. Otherwise → waiting
pub fn determine_status(
    current: &StatusSignals,
    previous_io: Option<&(u64, u64)>,
    previous_cpu_ticks: Option<u64>,
) -> AgentStatus {
    if current.child_count > 0 {
        return AgentStatus::Coding;
    }

    let cpu_delta = previous_cpu_ticks
        .map(|prev| current.cpu_ticks.saturating_sub(prev))
        .unwrap_or(0);
    let cpu_active = cpu_delta > CPU_ACTIVE_TICKS;

    let read_delta = previous_io
        .map(|(prev_read, _)| current.io_read_bytes.saturating_sub(*prev_read))
        .unwrap_or(0);
    let big_read = read_delta > THINK_RCHAR_BYTES;

    if !cpu_active {
        return AgentStatus::Waiting;
    }

    if big_read {
        AgentStatus::Thinking
    } else {
        // CPU active without a network stream: internal tool (Edit/Read/Write)
        // or finishing processing after a stream ended.
        AgentStatus::Coding
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_ps_line() {
        let output = "PS:  3726  1.0  1.1\n";
        let (procs, _) = parse_process_output(output);
        assert_eq!(procs.len(), 1);
        let p = &procs[&3726];
        assert_eq!(p.pid, 3726);
        assert!((p.cpu - 1.0).abs() < 0.01);
    }

    #[test]
    fn test_parse_net_line() {
        let output = "NET:3726:2\n";
        let (_, signals) = parse_process_output(output);
        assert!(signals[&3726].has_https_connection);
    }

    #[test]
    fn test_parse_io_line() {
        let output = "IO:3726:1024:2048\n";
        let (_, signals) = parse_process_output(output);
        assert_eq!(signals[&3726].io_read_bytes, 1024);
        assert_eq!(signals[&3726].io_write_bytes, 2048);
    }

    #[test]
    fn test_parse_children_line() {
        let output = "CHILDREN:3726:3\n";
        let (_, signals) = parse_process_output(output);
        assert_eq!(signals[&3726].child_count, 3);
    }

    #[test]
    fn test_parse_cpu_line() {
        let output = "CPU:3726:4812\n";
        let (_, signals) = parse_process_output(output);
        assert_eq!(signals[&3726].cpu_ticks, 4812);
    }

    fn sig(read: u64, ticks: u64, children: u32) -> StatusSignals {
        StatusSignals {
            has_https_connection: false,
            io_read_bytes: read,
            io_write_bytes: 0,
            child_count: children,
            cpu_ticks: ticks,
        }
    }

    #[test]
    fn test_status_coding_when_shell_child_exists() {
        let s = sig(0, 100, 1);
        assert_eq!(
            determine_status(&s, None, Some(100)),
            AgentStatus::Coding
        );
    }

    #[test]
    fn test_status_thinking_when_cpu_active_and_network_stream() {
        let s = sig(200_000, 200, 0);
        let prev_io = (100_000u64, 0u64);
        assert_eq!(
            determine_status(&s, Some(&prev_io), Some(100)),
            AgentStatus::Thinking
        );
    }

    #[test]
    fn test_status_coding_when_cpu_active_no_stream() {
        // Internal tool like Edit/Read: CPU busy, no big network read
        let s = sig(1_000, 200, 0);
        let prev_io = (0u64, 0u64);
        assert_eq!(
            determine_status(&s, Some(&prev_io), Some(100)),
            AgentStatus::Coding
        );
    }

    #[test]
    fn test_status_waiting_when_cpu_idle_despite_tui_noise() {
        // Typical idle: small rchar/wchar, tiny CPU delta
        let s = sig(3_000, 102, 0);
        let prev_io = (1_000u64, 0u64);
        assert_eq!(
            determine_status(&s, Some(&prev_io), Some(100)),
            AgentStatus::Waiting
        );
    }

    #[test]
    fn test_status_waiting_when_network_spike_but_cpu_quiet() {
        // MCP sync burst: big rchar delta but CPU didn't actually work
        let s = sig(500_000, 102, 0);
        let prev_io = (0u64, 0u64);
        assert_eq!(
            determine_status(&s, Some(&prev_io), Some(100)),
            AgentStatus::Waiting
        );
    }

    #[test]
    fn test_parse_full_output() {
        let output = "\
PS:  3726  1.0  1.1
NET:3726:1
IO:3726:500:300
CHILDREN:3726:0
PS:  5481  0.5  0.8
NET:5481:0
IO:5481:200:100
CHILDREN:5481:2
";
        let (procs, signals) = parse_process_output(output);
        assert_eq!(procs.len(), 2);
        assert!(signals[&3726].has_https_connection);
        assert!(!signals[&5481].has_https_connection);
        assert_eq!(signals[&5481].child_count, 2);
    }
}
