// Stage R4 native host process table primitive (std-only, zero external crates).
// Pure `/proc/<pid>/{stat,statm}` parsers run everywhere for deterministic unit tests;
// live host listings scan `/proc` on Linux without external crates.

use std::fmt::Write as _;
#[cfg(target_os = "linux")]
use std::fs;

pub const MAX_PROCESS_LIMIT: usize = 200;

#[derive(Debug, Clone, PartialEq)]
pub struct NativeProcess {
    pub pid: u32,
    pub name: String,
    pub status: String,
    pub cpu: f64,
    pub mem: u64,
}

/// Parses a Linux `/proc/<pid>/stat` line into `(comm, state_char)`.
/// Safely handles process names (`comm`) containing spaces or nested parentheses
/// by matching the first `(` and the last `)`.
pub fn parse_proc_stat(raw: &str) -> Option<(String, String)> {
    let start = raw.find('(')?;
    let end = raw.rfind(')')?;
    if end <= start {
        return None;
    }

    let pid_part = raw[..start].trim();
    if pid_part.is_empty() || !pid_part.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }

    let comm = &raw[start + 1..end];
    if comm.is_empty() {
        return None;
    }

    let state = raw[end + 1..].split_whitespace().next()?;
    if state.len() != 1 || !state.bytes().all(|b| b.is_ascii_alphabetic()) {
        return None;
    }

    Some((comm.to_string(), state.to_string()))
}

/// Parses a Linux `/proc/<pid>/statm` line and computes resident memory (RSS) in MiB
/// from field 2 (`resident` pages) using `page_size_bytes`.
pub fn parse_proc_statm_rss_mib(raw: &str, page_size_bytes: u64) -> Option<u64> {
    if page_size_bytes == 0 {
        return None;
    }
    let mut parts = raw.split_whitespace();
    let _size_pages: u64 = parts.next()?.parse().ok()?;
    let resident_pages: u64 = parts.next()?.parse().ok()?;
    let rss_bytes = (resident_pages as u128).saturating_mul(page_size_bytes as u128);
    let rss_mib = rss_bytes / (1024 * 1024);
    Some(rss_mib.min(u64::MAX as u128) as u64)
}

#[cfg(target_os = "linux")]
fn linux_page_size_bytes() -> u64 {
    const AT_NULL: usize = 0;
    const AT_PAGESZ: usize = 6;
    const DEFAULT_PAGE_SIZE: u64 = 4096;

    let Ok(bytes) = fs::read("/proc/self/auxv") else {
        return DEFAULT_PAGE_SIZE;
    };
    let word = std::mem::size_of::<usize>();
    let entry_len = word * 2;
    for chunk in bytes.chunks_exact(entry_len) {
        let Ok(k_arr) = chunk[..word].try_into() else {
            break;
        };
        let Ok(v_arr) = chunk[word..].try_into() else {
            break;
        };
        let key = usize::from_ne_bytes(k_arr);
        let val = usize::from_ne_bytes(v_arr);
        if key == AT_NULL {
            break;
        }
        if key == AT_PAGESZ && val >= 4096 && val.is_power_of_two() {
            return val as u64;
        }
    }
    DEFAULT_PAGE_SIZE
}

/// Reads running Linux processes from `/proc/<pid>/{stat,statm}`, sorted by
/// RSS `mem` descending then `pid` ascending, capped at `limit.min(200)`.
#[cfg(target_os = "linux")]
pub fn read_linux_processes(limit: usize) -> Result<Vec<NativeProcess>, String> {
    let cap = limit.min(MAX_PROCESS_LIMIT);
    let read_dir = fs::read_dir("/proc").map_err(|e| format!("failed to read /proc: {e}"))?;
    if cap == 0 {
        return Ok(Vec::new());
    }

    let page_size = linux_page_size_bytes();
    let mut procs = Vec::new();

    for entry in read_dir.flatten() {
        let file_name = entry.file_name();
        let Some(name_str) = file_name.to_str() else {
            continue;
        };
        if name_str.is_empty() || !name_str.bytes().all(|b| b.is_ascii_digit()) {
            continue;
        }
        let Ok(pid) = name_str.parse::<u32>() else {
            continue;
        };

        let proc_dir = entry.path();
        let Ok(stat_raw) = fs::read_to_string(proc_dir.join("stat")) else {
            continue;
        };
        let Ok(statm_raw) = fs::read_to_string(proc_dir.join("statm")) else {
            continue;
        };

        let Some((name, status)) = parse_proc_stat(&stat_raw) else {
            continue;
        };
        let Some(mem) = parse_proc_statm_rss_mib(&statm_raw, page_size) else {
            continue;
        };

        procs.push(NativeProcess {
            pid,
            name,
            status,
            cpu: 0.0,
            mem,
        });
    }

    procs.sort_by(|a, b| b.mem.cmp(&a.mem).then_with(|| a.pid.cmp(&b.pid)));
    procs.truncate(cap);
    Ok(procs)
}

/// Returns an explicit unsupported-platform error on non-Linux hosts.
#[cfg(not(target_os = "linux"))]
pub fn read_linux_processes(_limit: usize) -> Result<Vec<NativeProcess>, String> {
    Err("read_linux_processes is only supported on Linux".to_string())
}

fn push_escaped_json_str(out: &mut String, input: &str) {
    for ch in input.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\x08' => out.push_str("\\b"),
            '\x0c' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 || c == '\x7f' => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
}

/// Serializes processes to the `/api/v1/sys/processes` JSON array contract:
/// `[{"pid":...,"name":...,"status":...,"cpu":...,"mem":...}]`.
pub fn processes_to_json(list: &[NativeProcess]) -> String {
    let mut out = String::with_capacity(list.len().saturating_mul(64) + 2);
    out.push('[');
    for (idx, proc_item) in list.iter().enumerate() {
        if idx > 0 {
            out.push(',');
        }
        let cpu = if proc_item.cpu.is_finite() && proc_item.cpu >= 0.0 {
            (proc_item.cpu * 10.0).round() / 10.0
        } else {
            0.0
        };
        let _ = write!(&mut out, r#"{{"pid":{},"name":""#, proc_item.pid);
        push_escaped_json_str(&mut out, &proc_item.name);
        out.push_str(r#"","status":""#);
        push_escaped_json_str(&mut out, &proc_item.status);
        let _ = write!(&mut out, r#"","cpu":{cpu:.1},"mem":{}}}"#, proc_item.mem);
    }
    out.push(']');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_proc_stat_with_spaces_parentheses_and_rejects_malformed_lines() {
        assert_eq!(
            parse_proc_stat("1 (systemd) S 0 1 1 0 -1 4194560"),
            Some(("systemd".to_string(), "S".to_string()))
        );
        assert_eq!(
            parse_proc_stat("42 (Web Content) R 1 42 42 0 -1"),
            Some(("Web Content".to_string(), "R".to_string()))
        );
        assert_eq!(
            parse_proc_stat("999 (my (nested) ) proc) Z 1 999 999"),
            Some(("my (nested) ) proc".to_string(), "Z".to_string()))
        );
        assert_eq!(
            parse_proc_stat("2 (kworker/u8:1+events_unbound) I 0 0 0\n"),
            Some(("kworker/u8:1+events_unbound".to_string(), "I".to_string()))
        );

        assert!(parse_proc_stat("").is_none());
        assert!(parse_proc_stat("123 no-parens S 0").is_none());
        assert!(parse_proc_stat("123 () S 0").is_none());
        assert!(parse_proc_stat("123 )backwards( S 0").is_none());
        assert!(parse_proc_stat("abc (proc) S 0").is_none());
        assert!(parse_proc_stat("123 (proc)").is_none());
        assert!(parse_proc_stat("123 (proc) SLEEP 0").is_none());
        assert!(parse_proc_stat("123 (proc) 9 0").is_none());
    }

    #[test]
    fn parses_proc_statm_rss_mib_across_page_sizes_and_rejects_invalid_inputs() {
        // 1024 pages * 4096 B = 4 MiB
        assert_eq!(parse_proc_statm_rss_mib("5000 1024 512 10 0 200 0\n", 4096), Some(4));
        // 0 resident pages = 0 MiB
        assert_eq!(parse_proc_statm_rss_mib("100 0 0 0 0 0 0", 4096), Some(0));
        // 256 pages * 16384 B = 4 MiB (16 KiB pages)
        assert_eq!(parse_proc_statm_rss_mib("1000 256 10 0 0 0 0", 16_384), Some(4));
        // Sub-MiB resident truncates cleanly to 0 MiB
        assert_eq!(parse_proc_statm_rss_mib("100 128 0 0 0 0 0", 4096), Some(0));
        // Large resident count avoids u64 multiplication overflow via u128
        assert_eq!(parse_proc_statm_rss_mib("2000000 1048576 0", 4096), Some(4096));

        assert!(parse_proc_statm_rss_mib("", 4096).is_none());
        assert!(parse_proc_statm_rss_mib("1000", 4096).is_none());
        assert!(parse_proc_statm_rss_mib("1000 bad 0", 4096).is_none());
        assert!(parse_proc_statm_rss_mib("bad 1000 0", 4096).is_none());
        assert!(parse_proc_statm_rss_mib("1000 1024 0", 0).is_none());
    }

    #[test]
    fn serializes_processes_to_json_with_proper_escaping_and_cpu_sanitization() {
        assert_eq!(processes_to_json(&[]), "[]");

        let list = vec![
            NativeProcess {
                pid: 101,
                name: "node \"app\"\\srv\n\t\x07".to_string(),
                status: "S".to_string(),
                cpu: 12.34,
                mem: 256,
            },
            NativeProcess {
                pid: 202,
                name: "worker".to_string(),
                status: "R".to_string(),
                cpu: f64::NAN,
                mem: 64,
            },
            NativeProcess {
                pid: 303,
                name: "idle".to_string(),
                status: "I".to_string(),
                cpu: -3.5,
                mem: 0,
            },
        ];

        assert_eq!(
            processes_to_json(&list),
            concat!(
                r#"[{"pid":101,"name":"node \"app\"\\srv\n\t\u0007","status":"S","cpu":12.3,"mem":256},"#,
                r#"{"pid":202,"name":"worker","status":"R","cpu":0.0,"mem":64},"#,
                r#"{"pid":303,"name":"idle","status":"I","cpu":0.0,"mem":0}]"#
            )
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn reads_live_linux_processes_sorted_by_mem_desc_pid_asc_and_capped() {
        let list = read_linux_processes(50).expect("live Linux /proc process scan should succeed");
        assert!(!list.is_empty(), "expected at least one running Linux process");
        assert!(list.len() <= 50, "expected <= 50 processes, got {}", list.len());

        for item in &list {
            assert!(item.pid > 0);
            assert!(!item.name.is_empty());
            assert_eq!(item.status.len(), 1);
            assert!(item.cpu.is_finite() && item.cpu >= 0.0);
        }

        for pair in list.windows(2) {
            let a = &pair[0];
            let b = &pair[1];
            assert!(
                a.mem > b.mem || (a.mem == b.mem && a.pid < b.pid),
                "processes not sorted by mem desc then pid asc: {a:?} before {b:?}"
            );
        }

        let small = read_linux_processes(3).unwrap();
        assert!(small.len() <= 3);

        let hard_capped = read_linux_processes(500).unwrap();
        assert!(hard_capped.len() <= MAX_PROCESS_LIMIT);

        let empty = read_linux_processes(0).unwrap();
        assert!(empty.is_empty());

        let json = processes_to_json(&small);
        assert!(json.starts_with('[') && json.ends_with(']'));
        if !small.is_empty() {
            assert!(json.contains(r#""pid":"#));
            assert!(json.contains(r#""name":"#));
            assert!(json.contains(r#""status":"#));
            assert!(json.contains(r#""cpu":"#));
            assert!(json.contains(r#""mem":"#));
        }
    }
}
