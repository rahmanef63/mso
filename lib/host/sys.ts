// SERVER-ONLY. Host telemetry behind /api/v1/sys/*. CPU% is a short two-sample
// delta of /proc/stat on Linux or os.cpus() elsewhere. Memory/disk/uptime come
// from Node; process inventory uses fixed platform commands without shell input.
import os from "os";
import { promises as fs } from "fs";
import type { Process, SysStats } from "@/lib/os-api/types";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function cpuSample(): Promise<{ idle: number; total: number }> {
  if (process.platform !== "linux") {
    const times = os.cpus().map((core) => core.times);
    return {
      idle: times.reduce((sum, core) => sum + core.idle, 0),
      total: times.reduce((sum, core) => sum + Object.values(core).reduce((a, b) => a + b, 0), 0),
    };
  }
  try {
    const line = (await fs.readFile("/proc/stat", "utf8")).split("\n")[0];
    const n = line.trim().split(/\s+/).slice(1).map(Number);
    const idle = (n[3] || 0) + (n[4] || 0);
    const total = n.reduce((a, b) => a + (b || 0), 0);
    return { idle, total };
  } catch {
    return { idle: 0, total: 0 };
  }
}

// CPU% needs two /proc/stat samples. Taking both inside one request means every
// caller pays a 120ms sleep — and the System Monitor polls this every 1500ms, so
// the handler sat blocked for 8% of wall-clock forever. Keep the last sample
// instead: a poll that arrives while a usable one is on hand diffs against it and
// returns immediately.
//
// The window has both ends for a reason. Below MIN, the delta is too few jiffies
// to mean anything (and can read 0 on an idle box). Above MAX, the delta stops
// being "now" — a sample from ten minutes ago would report the ten-minute average
// as the current load. Outside the window we fall back to the honest two-sample
// read, so correctness never depends on how often someone happens to be polling.
const REUSE_MIN_MS = 200;
const REUSE_MAX_MS = 10_000;
let lastSample: { at: number; idle: number; total: number } | null = null;

export async function stats(): Promise<SysStats> {
  const now = Date.now();
  const prev = lastSample;
  const reusable = prev && now - prev.at >= REUSE_MIN_MS && now - prev.at <= REUSE_MAX_MS;

  let a: { idle: number; total: number };
  if (reusable) {
    a = prev;
  } else {
    a = await cpuSample();
    await new Promise((r) => setTimeout(r, 120));
  }
  const b = await cpuSample();
  lastSample = { at: Date.now(), idle: b.idle, total: b.total };

  const dt = b.total - a.total;
  const di = b.idle - a.idle;
  const pct = dt > 0 ? Math.max(0, Math.min(100, Math.round((1 - di / dt) * 100))) : 0;

  let disk = { used: 0, total: 0 };
  try {
    const s = await fs.statfs(process.platform === "win32" ? os.homedir() : "/");
    const total = s.blocks * s.bsize;
    disk = { used: total - s.bfree * s.bsize, total };
  } catch {
    /* non-linux / no statfs → zeros */
  }

  return {
    cpu: { pct, cores: os.cpus().length },
    mem: { used: os.totalmem() - os.freemem(), total: os.totalmem() },
    disk,
    net: { rx: 0, tx: 0 },
    uptime: os.uptime() * 1000,
  };
}

export function parsePosixProcesses(output: string): Process[] {
  return output.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const fields = line.split(/\s+/);
    if (fields.length < 5) return null;
    const pid = Number(fields[0]);
    const cpu = Number(fields[fields.length - 3]);
    const rss = Number(fields[fields.length - 2]);
    if (!Number.isInteger(pid) || pid <= 0) return null;
    return {
      pid,
      name: fields.slice(1, -3).join(" "),
      cpu: Number.isFinite(cpu) ? cpu : 0,
      mem: Math.round((Number.isFinite(rss) ? rss : 0) / 1024),
      status: fields[fields.length - 1] || "",
    };
  }).filter((p): p is Process => p !== null).sort((a, b) => b.cpu - a.cpu).slice(0, 40);
}

export function parseWindowsProcesses(output: string, cores: number): Process[] {
  const parsed: unknown = JSON.parse(output);
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows.filter((row): row is Record<string, unknown> => !!row && typeof row === "object").map((row) => ({
    pid: Number(row.IDProcess) || 0,
    name: String(row.Name || "?"),
    cpu: Math.min(100, (Number(row.PercentProcessorTime) || 0) / Math.max(1, cores)),
    mem: Math.round((Number(row.WorkingSet) || 0) / (1024 * 1024)),
    status: "running",
  })).filter((row) => row.pid > 0).sort((a, b) => b.cpu - a.cpu).slice(0, 40);
}

export async function processes(): Promise<Process[]> {
  if (process.platform === "win32") {
    const command = "Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Select-Object IDProcess,Name,PercentProcessorTime,WorkingSet | ConvertTo-Json -Compress";
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { timeout: 15_000, maxBuffer: 1_000_000 });
    return parseWindowsProcesses(stdout, os.cpus().length);
  }
  const args = process.platform === "darwin"
    ? ["-axo", "pid=,comm=,%cpu=,rss=,stat="]
    : ["-eo", "pid,comm,pcpu,rss,stat", "--sort=-pcpu", "--no-headers"];
  const { stdout } = await execFileAsync("ps", args, { timeout: 15_000, maxBuffer: 1_000_000 });
  return parsePosixProcesses(stdout);
}
