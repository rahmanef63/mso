// Stage R4 native host metrics primitive (std-only, zero external crates).
// Pure `/proc` parsers run everywhere for deterministic unit tests; live host
// snapshots read `/proc/meminfo`, `/proc/uptime`, and `/proc/stat` on Linux.

#[cfg(target_os = "linux")]
use std::fs;
#[cfg(target_os = "linux")]
use std::process::Command;
#[cfg(target_os = "linux")]
use std::sync::Mutex;
#[cfg(target_os = "linux")]
use std::thread;
#[cfg(target_os = "linux")]
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MemReading {
    pub used_bytes: u64,
    pub total_bytes: u64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct NativeSysSnapshot {
    pub cpu_pct: f64,
    pub cpu_cores: usize,
    pub mem_used: u64,
    pub mem_total: u64,
    pub disk_used: u64,
    pub disk_total: u64,
    pub net_rx: u64,
    pub net_tx: u64,
    pub uptime_ms: u64,
}

impl NativeSysSnapshot {
    /// Serializes the snapshot to match the `/api/v1/sys/stats` JSON contract.
    pub fn to_json(&self) -> String {
        let pct = if self.cpu_pct.is_finite() {
            self.cpu_pct.clamp(0.0, 100.0)
        } else {
            0.0
        };
        let pct_rounded = (pct * 10.0).round() / 10.0;
        format!(
            r#"{{"cpu":{{"pct":{pct_rounded:.1},"cores":{}}},"mem":{{"used":{},"total":{}}},"disk":{{"used":{},"total":{}}},"net":{{"rx":{},"tx":{}}},"uptime":{}}}"#,
            self.cpu_cores,
            self.mem_used,
            self.mem_total,
            self.disk_used,
            self.disk_total,
            self.net_rx,
            self.net_tx,
            self.uptime_ms,
        )
    }
}

/// Parses POSIX `df -B1 -P /` output into `(used_bytes, total_bytes)`.
pub fn parse_df_root_bytes(raw: &str) -> Option<(u64, u64)> {
    let data_line = raw.lines().skip(1).find(|l| !l.trim().is_empty())?;
    let cols: Vec<&str> = data_line.split_whitespace().collect();
    if cols.len() < 4 {
        return None;
    }
    let total = cols[1].parse::<u64>().ok()?;
    let used = cols[2].parse::<u64>().ok()?;
    if total == 0 {
        return None;
    }
    Some((used.min(total), total))
}

/// Parses Linux `/proc/net/dev` into aggregate non-loopback `(rx_bytes, tx_bytes)`.
pub fn parse_proc_net_dev(raw: &str) -> (u64, u64) {
    let mut rx: u64 = 0;
    let mut tx: u64 = 0;
    for line in raw.lines().skip(2) {
        let Some((iface, rest)) = line.split_once(':') else {
            continue;
        };
        if iface.trim() == "lo" {
            continue;
        }
        let nums: Vec<&str> = rest.split_whitespace().collect();
        if nums.len() >= 9 {
            if let Ok(r) = nums[0].parse::<u64>() {
                rx = rx.saturating_add(r);
            }
            if let Ok(t) = nums[8].parse::<u64>() {
                tx = tx.saturating_add(t);
            }
        }
    }
    (rx, tx)
}

fn parse_meminfo_bytes(value_part: &str) -> Option<u64> {
    let mut parts = value_part.split_whitespace();
    let num: u64 = parts.next()?.parse().ok()?;
    match parts.next() {
        None | Some("kB") => Some(num.saturating_mul(1024)),
        Some("B") => Some(num),
        Some(_) => None,
    }
}

/// Parses Linux `/proc/meminfo` contents into total and used bytes.
/// Prefers `MemAvailable`, falling back to `MemFree + Buffers + Cached`.
pub fn parse_proc_meminfo(raw: &str) -> Option<MemReading> {
    let mut mem_total: Option<u64> = None;
    let mut mem_available: Option<u64> = None;
    let mut mem_free: Option<u64> = None;
    let mut buffers: u64 = 0;
    let mut cached: u64 = 0;

    for line in raw.lines() {
        let Some((key, val)) = line.split_once(':') else {
            continue;
        };
        match key.trim() {
            "MemTotal" => mem_total = parse_meminfo_bytes(val),
            "MemAvailable" => mem_available = parse_meminfo_bytes(val),
            "MemFree" => mem_free = parse_meminfo_bytes(val),
            "Buffers" => {
                if let Some(b) = parse_meminfo_bytes(val) {
                    buffers = b;
                }
            }
            "Cached" => {
                if let Some(c) = parse_meminfo_bytes(val) {
                    cached = c;
                }
            }
            _ => {}
        }
    }

    let total_bytes = mem_total.filter(|&t| t > 0)?;
    let avail_bytes = match mem_available {
        Some(avail) => avail,
        None => mem_free?.saturating_add(buffers).saturating_add(cached),
    };
    let used_bytes = total_bytes.saturating_sub(avail_bytes);
    Some(MemReading {
        used_bytes,
        total_bytes,
    })
}

/// Parses Linux `/proc/uptime` contents into uptime milliseconds.
pub fn parse_proc_uptime(raw: &str) -> Option<u64> {
    let first = raw.split_whitespace().next()?;
    let secs: f64 = first.parse().ok()?;
    if !secs.is_finite() || secs < 0.0 || secs > (u64::MAX as f64 / 1000.0) {
        return None;
    }
    Some((secs * 1000.0).round() as u64)
}

/// Parses the aggregate `cpu ` line from Linux `/proc/stat` into `(busy_ticks, total_ticks)`.
pub fn parse_proc_cpu_sample(raw: &str) -> Option<(u64, u64)> {
    let line = raw
        .lines()
        .find(|l| l.split_whitespace().next() == Some("cpu"))?;
    let mut fields = Vec::with_capacity(10);
    for token in line.split_whitespace().skip(1) {
        fields.push(token.parse::<u64>().ok()?);
    }
    if fields.len() < 4 {
        return None;
    }
    let idle_ticks = fields[3].saturating_add(fields.get(4).copied().unwrap_or(0));
    let total_ticks = fields.iter().copied().fold(0u64, u64::saturating_add);
    let busy_ticks = total_ticks.saturating_sub(idle_ticks);
    Some((busy_ticks, total_ticks))
}

/// Counts per-core `cpu<N>` entries in `/proc/stat`.
pub fn parse_proc_cpu_cores(raw: &str) -> usize {
    raw.lines()
        .filter(|line| {
            line.split_whitespace()
                .next()
                .and_then(|tok| tok.strip_prefix("cpu"))
                .is_some_and(|rest| !rest.is_empty() && rest.bytes().all(|b| b.is_ascii_digit()))
        })
        .count()
}

/// Computes CPU utilization percentage in `[0.0, 100.0]` between two `(busy_ticks, total_ticks)` samples.
pub fn cpu_pct_between(a: (u64, u64), b: (u64, u64)) -> f64 {
    let dt = b.1.saturating_sub(a.1);
    if dt == 0 {
        return 0.0;
    }
    let db = b.0.saturating_sub(a.0).min(dt);
    ((db as f64 / dt as f64) * 100.0).clamp(0.0, 100.0)
}

#[cfg(target_os = "linux")]
const CPU_REUSE_MIN: Duration = Duration::from_millis(200);
#[cfg(target_os = "linux")]
const CPU_REUSE_MAX: Duration = Duration::from_secs(10);
#[cfg(target_os = "linux")]
const CPU_SAMPLE_DELAY: Duration = Duration::from_millis(50);

#[cfg(target_os = "linux")]
static LAST_CPU_SAMPLE: Mutex<Option<(Instant, (u64, u64))>> = Mutex::new(None);
#[cfg(target_os = "linux")]
static LAST_DISK_SAMPLE: Mutex<Option<(Instant, (u64, u64))>> = Mutex::new(None);
#[cfg(target_os = "linux")]
const DISK_CACHE_TTL: Duration = Duration::from_secs(30);

#[cfg(target_os = "linux")]
fn read_root_disk_bytes() -> (u64, u64) {
    {
        let guard = LAST_DISK_SAMPLE.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((at, reading)) = *guard {
            if at.elapsed() < DISK_CACHE_TTL {
                return reading;
            }
        }
    }
    let reading = Command::new("df")
        .args(["-B1", "-P", "/"])
        .output()
        .ok()
        .filter(|out| out.status.success())
        .and_then(|out| String::from_utf8(out.stdout).ok())
        .and_then(|text| parse_df_root_bytes(&text))
        .unwrap_or((0, 0));
    {
        let mut guard = LAST_DISK_SAMPLE.lock().unwrap_or_else(|e| e.into_inner());
        *guard = Some((Instant::now(), reading));
    }
    reading
}

/// Reads a live host metrics snapshot from Linux `/proc` filesystems.
#[cfg(target_os = "linux")]
pub fn read_linux_snapshot() -> Result<NativeSysSnapshot, String> {
    let stat_a = fs::read_to_string("/proc/stat")
        .map_err(|e| format!("failed to read /proc/stat: {e}"))?;
    let sample_now = parse_proc_cpu_sample(&stat_a)
        .ok_or_else(|| "failed to parse /proc/stat aggregate cpu line".to_string())?;

    let cached_prev = {
        let guard = LAST_CPU_SAMPLE.lock().unwrap_or_else(|e| e.into_inner());
        guard.and_then(|(at, sample)| {
            let elapsed = at.elapsed();
            if elapsed >= CPU_REUSE_MIN && elapsed <= CPU_REUSE_MAX {
                Some(sample)
            } else {
                None
            }
        })
    };

    let (sample_a, sample_b, latest_stat) = if let Some(prev) = cached_prev {
        (prev, sample_now, stat_a)
    } else {
        thread::sleep(CPU_SAMPLE_DELAY);
        let stat_b = fs::read_to_string("/proc/stat")
            .map_err(|e| format!("failed to read second /proc/stat sample: {e}"))?;
        let second = parse_proc_cpu_sample(&stat_b)
            .ok_or_else(|| "failed to parse second /proc/stat aggregate cpu line".to_string())?;
        (sample_now, second, stat_b)
    };

    {
        let mut guard = LAST_CPU_SAMPLE.lock().unwrap_or_else(|e| e.into_inner());
        *guard = Some((Instant::now(), sample_b));
    }

    let cpu_pct = cpu_pct_between(sample_a, sample_b);
    let parsed_cores = parse_proc_cpu_cores(&latest_stat);
    let cpu_cores = if parsed_cores > 0 {
        parsed_cores
    } else {
        thread::available_parallelism()
            .map(usize::from)
            .unwrap_or(1)
    };

    let meminfo_raw = fs::read_to_string("/proc/meminfo")
        .map_err(|e| format!("failed to read /proc/meminfo: {e}"))?;
    let mem = parse_proc_meminfo(&meminfo_raw)
        .ok_or_else(|| "failed to parse /proc/meminfo".to_string())?;

    let uptime_raw = fs::read_to_string("/proc/uptime")
        .map_err(|e| format!("failed to read /proc/uptime: {e}"))?;
    let uptime_ms = parse_proc_uptime(&uptime_raw)
        .ok_or_else(|| "failed to parse /proc/uptime".to_string())?;

    let (disk_used, disk_total) = read_root_disk_bytes();
    let (net_rx, net_tx) = fs::read_to_string("/proc/net/dev")
        .map(|raw| parse_proc_net_dev(&raw))
        .unwrap_or((0, 0));

    Ok(NativeSysSnapshot {
        cpu_pct,
        cpu_cores,
        mem_used: mem.used_bytes,
        mem_total: mem.total_bytes,
        disk_used,
        disk_total,
        net_rx,
        net_tx,
        uptime_ms,
    })
}

/// Returns an explicit unsupported-platform error on non-Linux hosts.
#[cfg(not(target_os = "linux"))]
pub fn read_linux_snapshot() -> Result<NativeSysSnapshot, String> {
    Err("read_linux_snapshot is only supported on Linux".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_proc_meminfo_with_memavailable_and_fallback() {
        let with_avail = "\
MemTotal:       16384000 kB
MemFree:         2000000 kB
MemAvailable:   10240000 kB
Buffers:          500000 kB
Cached:          4000000 kB
SwapCached:       123456 kB
";
        let reading = parse_proc_meminfo(with_avail).unwrap();
        assert_eq!(reading.total_bytes, 16_384_000 * 1024);
        assert_eq!(reading.used_bytes, (16_384_000 - 10_240_000) * 1024);

        // Fallback when MemAvailable is absent: MemFree + Buffers + Cached (ignoring SwapCached)
        let fallback = "\
MemTotal:       10000000 kB
MemFree:         2000000 kB
Buffers:          500000 kB
Cached:          3500000 kB
SwapCached:      1000000 kB
";
        let fb = parse_proc_meminfo(fallback).unwrap();
        assert_eq!(fb.total_bytes, 10_000_000 * 1024);
        assert_eq!(fb.used_bytes, (10_000_000 - 6_000_000) * 1024);

        // Saturates cleanly if available exceeds total
        let saturated = "MemTotal: 1000 kB\nMemAvailable: 2000 kB\n";
        let sat = parse_proc_meminfo(saturated).unwrap();
        assert_eq!(sat.total_bytes, 1000 * 1024);
        assert_eq!(sat.used_bytes, 0);

        // Rejects missing MemTotal, zero MemTotal, or missing both MemAvailable and MemFree
        assert!(parse_proc_meminfo("").is_none());
        assert!(parse_proc_meminfo("MemTotal: 0 kB\nMemAvailable: 0 kB\n").is_none());
        assert!(parse_proc_meminfo("MemTotal: 1000 kB\nBuffers: 100 kB\n").is_none());
        assert!(parse_proc_meminfo("MemAvailable: 1000 kB\n").is_none());
    }

    #[test]
    fn parses_proc_uptime_to_milliseconds() {
        assert_eq!(parse_proc_uptime("12345.67 98765.43\n"), Some(12_345_670));
        assert_eq!(parse_proc_uptime("0.00 0.00"), Some(0));
        assert_eq!(parse_proc_uptime("42 100.5"), Some(42_000));
        assert_eq!(parse_proc_uptime("  1.2349 9.0  "), Some(1_235));

        assert!(parse_proc_uptime("").is_none());
        assert!(parse_proc_uptime("-5.0 1.0").is_none());
        assert!(parse_proc_uptime("NaN 1.0").is_none());
        assert!(parse_proc_uptime("inf 1.0").is_none());
        assert!(parse_proc_uptime("not-a-number 1.0").is_none());
    }

    #[test]
    fn parses_proc_cpu_sample_cores_and_computes_delta_percentage() {
        let stat_a = "\
cpu  100 10 90 700 100 0 0 0 0 0
cpu0 50 5 45 350 50 0 0 0 0 0
cpu1 50 5 45 350 50 0 0 0 0 0
intr 12345
";
        let stat_b = "\
cpu  150 10 115 725 100 0 0 0 0 0
cpu0 75 5 55 365 50 0 0 0 0 0
cpu1 75 5 60 360 50 0 0 0 0 0
";
        let a = parse_proc_cpu_sample(stat_a).unwrap();
        let b = parse_proc_cpu_sample(stat_b).unwrap();
        // a: total = 1000, idle = 700 + 100 = 800, busy = 200
        assert_eq!(a, (200, 1000));
        // b: total = 1100, idle = 725 + 100 = 825, busy = 275
        assert_eq!(b, (275, 1100));
        // delta: db = 75, dt = 100 => 75.0%
        assert!((cpu_pct_between(a, b) - 75.0).abs() < 1e-9);
        assert_eq!(parse_proc_cpu_cores(stat_a), 2);

        // Minimal 4-field cpu line
        assert_eq!(parse_proc_cpu_sample("cpu 10 0 15 75\n"), Some((25, 100)));

        // Edge cases for cpu_pct_between
        assert_eq!(cpu_pct_between((100, 500), (100, 500)), 0.0);
        assert_eq!(cpu_pct_between((100, 500), (200, 600)), 100.0);
        assert_eq!(cpu_pct_between((200, 600), (100, 500)), 0.0);
        assert_eq!(cpu_pct_between((100, 500), (999, 550)), 100.0);

        // Rejects missing aggregate cpu line, too-short line, or non-numeric fields
        assert!(parse_proc_cpu_sample("cpu0 1 2 3 4\n").is_none());
        assert!(parse_proc_cpu_sample("cpu 1 2 3\n").is_none());
        assert!(parse_proc_cpu_sample("cpu 1 2 bad 4\n").is_none());
    }

    #[test]
    fn parses_df_root_bytes_and_proc_net_dev() {
        let df_out = "\
Filesystem     1-blocks        Used   Available Capacity Mounted on
/dev/sda1  107374182400 42949672960 64424509440      40% /
";
        assert_eq!(
            parse_df_root_bytes(df_out),
            Some((42_949_672_960, 107_374_182_400))
        );
        assert!(parse_df_root_bytes("").is_none());
        assert!(parse_df_root_bytes("Header only\n").is_none());

        let net_raw = "\
Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 999999   100    0    0    0     0          0         0   888888   100    0    0    0     0       0          0
  eth0: 120000    50    0    0    0     0          0         0    45000    25    0    0    0     0       0          0
 wlan0:   5000    10    0    0    0     0          0         0     2500     5    0    0    0     0       0          0
";
        assert_eq!(parse_proc_net_dev(net_raw), (125_000, 47_500));
    }

    #[test]
    fn formats_native_sys_snapshot_json_matching_sys_stats_schema() {
        let snap = NativeSysSnapshot {
            cpu_pct: 37.54,
            cpu_cores: 8,
            mem_used: 4_294_967_296,
            mem_total: 17_179_869_184,
            disk_used: 42_949_672_960,
            disk_total: 107_374_182_400,
            net_rx: 125_000,
            net_tx: 47_500,
            uptime_ms: 86_400_000,
        };
        assert_eq!(
            snap.to_json(),
            r#"{"cpu":{"pct":37.5,"cores":8},"mem":{"used":4294967296,"total":17179869184},"disk":{"used":42949672960,"total":107374182400},"net":{"rx":125000,"tx":47500},"uptime":86400000}"#
        );

        let clamped = NativeSysSnapshot {
            cpu_pct: f64::NAN,
            cpu_cores: 4,
            mem_used: 0,
            mem_total: 1024,
            disk_used: 0,
            disk_total: 0,
            net_rx: 0,
            net_tx: 0,
            uptime_ms: 0,
        };
        assert_eq!(
            clamped.to_json(),
            r#"{"cpu":{"pct":0.0,"cores":4},"mem":{"used":0,"total":1024},"disk":{"used":0,"total":0},"net":{"rx":0,"tx":0},"uptime":0}"#
        );

        let high = NativeSysSnapshot {
            cpu_pct: 145.0,
            cpu_cores: 2,
            mem_used: 512,
            mem_total: 1024,
            disk_used: 10,
            disk_total: 100,
            net_rx: 1,
            net_tx: 2,
            uptime_ms: 500,
        };
        assert!(high.to_json().contains(r#""pct":100.0"#));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn reads_live_linux_proc_snapshot() {
        let snap = read_linux_snapshot().expect("live Linux /proc snapshot should succeed");
        assert!(snap.cpu_cores >= 1, "expected at least 1 CPU core");
        assert!(snap.mem_total > 0, "expected non-zero total memory");
        assert!(
            snap.mem_used <= snap.mem_total,
            "used memory ({}) must not exceed total ({})",
            snap.mem_used,
            snap.mem_total
        );
        assert!(snap.disk_total > 0, "expected non-zero root disk total");
        assert!(snap.disk_used <= snap.disk_total);
        assert!(snap.uptime_ms > 0, "expected positive Linux uptime");
        assert!(
            snap.cpu_pct.is_finite() && (0.0..=100.0).contains(&snap.cpu_pct),
            "cpu_pct out of range: {}",
            snap.cpu_pct
        );

        let json = snap.to_json();
        assert!(json.starts_with(r#"{"cpu":{"pct":"#));
        assert!(json.contains(r#""mem":{"used":"#));
        assert!(json.contains(r#""disk":{"used":"#));
        assert!(json.contains(r#""net":{"rx":"#));
        assert!(json.contains(r#""uptime":"#));
        assert!(json.ends_with('}'));
    }
}
