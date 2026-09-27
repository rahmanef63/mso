// Telemetry formatters shared by every surface that renders SysStats/FsUsage
// (System Monitor, Settings → Account → About, terminal neofetch…). One machine → one
// set of numbers: binary GiB everywhere, uptime from the ms contract.
const GiB = 1024 ** 3;

export function fmtGiB(bytes: number): string {
  return (bytes / GiB).toFixed(1) + " GB";
}

export function toGiB(bytes: number): number {
  return bytes / GiB;
}

export function fmtGiBPair(used: number, total: number): string {
  return `${(used / GiB).toFixed(1)} / ${(total / GiB).toFixed(0)} GB`;
}

export function fmtPct(n: number): string {
  return Math.round(n) + "%";
}

// Net throughput already arrives as MB/s from the contract; clamp for display.
export function fmtMBs(n: number): string {
  return n.toFixed(1) + " MB/s";
}

// Keep a value inside a visible 0..100 band so gauges never collapse/overflow.
export function clampPct(n: number): number {
  return Math.max(0, Math.min(100, n));
}

/** SysStats.uptime is milliseconds — render as "Nd Nh" (or "Nh"). */
export function fmtUptime(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
}
