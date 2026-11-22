import "server-only";
import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SshTunnelRecord, SshTunnelSnapshot, SshTunnelView } from "@/lib/contracts/remote-connect";
import { redact } from "./redact";
import { commandExists } from "./runner";

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SAFE_USER = /^[a-zA-Z0-9._-]{1,64}$/;
const SAFE_HOST = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,252}$/;
const MAX_TUNNELS = 16;

interface RunningTunnel {
  child: ChildProcess;
  pid: number;
  error: string | null;
}

const activeTunnels = new Map<string, RunningTunnel>();

export function tunnelStorePath(): string {
  const custom = process.env.MSO_REMOTE_TUNNELS_FILE?.trim();
  if (custom) return path.resolve(custom);
  return path.join(os.homedir(), ".mso", "remote-tunnels.json");
}

function validPort(value: unknown, min: number, max: number): number {
  const num = Number(value);
  if (!Number.isInteger(num) || num < min || num > max) throw new Error(`Port must be between ${min} and ${max}`);
  return num;
}

function resolveSshKey(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  if (trimmed.includes("\0") || /[\r\n]/.test(trimmed)) throw new Error("Invalid SSH key path");
  const sshDir = path.resolve(path.join(os.homedir(), ".ssh"));
  const expanded = trimmed.startsWith("~/") ? path.join(os.homedir(), trimmed.slice(2)) : path.resolve(sshDir, trimmed);
  const resolved = path.resolve(expanded);
  if (resolved !== sshDir && !resolved.startsWith(`${sshDir}${path.sep}`)) {
    throw new Error("SSH key file must live inside ~/.ssh");
  }
  return resolved;
}

export function buildSshTunnelArgv(record: SshTunnelRecord): string[] {
  const resolvedKey = resolveSshKey(record.identityFile);
  return [
    "-N",
    "-o", "BatchMode=yes",
    "-o", "ExitOnForwardFailure=yes",
    "-o", "ServerAliveInterval=30",
    "-o", "ServerAliveCountMax=3",
    "-o", "ConnectTimeout=10",
    "-o", "StrictHostKeyChecking=accept-new",
    "-L", `127.0.0.1:${record.localPort}:127.0.0.1:${record.remotePort}`,
    "-p", String(record.sshPort),
    ...(resolvedKey ? ["-i", resolvedKey] : []),
    `${record.sshUser}@${record.sshHost}`,
  ];
}

async function readRecords(): Promise<SshTunnelRecord[]> {
  try {
    const raw = await fs.readFile(tunnelStorePath(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SshTunnelRecord[]) : [];
  } catch {
    return [];
  }
}

async function writeRecords(records: SshTunnelRecord[]): Promise<void> {
  const file = tunnelStorePath();
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.tmp.${process.pid}.${Date.now()}`;
  await fs.writeFile(temp, `${JSON.stringify(records, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temp, file);
}

function toView(record: SshTunnelRecord): SshTunnelView {
  const running = activeTunnels.get(record.id);
  const alive = Boolean(running && running.child.exitCode === null && !running.child.killed);
  return {
    ...record,
    active: alive,
    pid: alive ? running!.pid : null,
    localUrl: `http://127.0.0.1:${record.localPort}`,
    error: running?.error ?? null,
  };
}

export async function listSshTunnels(): Promise<SshTunnelSnapshot> {
  const [records, sshAvailable] = await Promise.all([readRecords(), commandExists("ssh")]);
  return {
    schemaVersion: 1,
    sshAvailable,
    tunnels: records.map(toView),
  };
}

export async function saveSshTunnel(input: {
  id: string;
  appId: string;
  title: string;
  sshUser: string;
  sshHost: string;
  sshPort?: number;
  remotePort: number;
  localPort: number;
  identityFile?: string;
}): Promise<SshTunnelView> {
  const id = input.id.trim().toLowerCase();
  const appId = input.appId.trim().toLowerCase();
  const title = input.title.trim();
  const sshUser = input.sshUser.trim();
  const sshHost = input.sshHost.trim();
  if (!SAFE_ID.test(id) || !SAFE_ID.test(appId)) throw new Error("Tunnel ID and App ID must use lowercase letters, numbers, and hyphens");
  if (!title || title.length > 120) throw new Error("Title is required");
  if (!SAFE_USER.test(sshUser) || !SAFE_HOST.test(sshHost)) throw new Error("Invalid SSH user or host");
  const sshPort = validPort(input.sshPort ?? 22, 1, 65535);
  const remotePort = validPort(input.remotePort, 1, 65535);
  const localPort = validPort(input.localPort, 1024, 65535);
  resolveSshKey(input.identityFile);

  const records = await readRecords();
  const existing = records.find((r) => r.id === id);
  if (!existing && records.length >= MAX_TUNNELS) throw new Error("Maximum number of SSH tunnels reached");
  if (records.some((r) => r.id !== id && r.localPort === localPort)) {
    throw new Error(`Local port ${localPort} is already assigned to another tunnel`);
  }
  const now = new Date().toISOString();
  const nextRecord: SshTunnelRecord = {
    id,
    appId,
    title,
    sshUser,
    sshHost,
    sshPort,
    remotePort,
    localPort,
    ...(input.identityFile?.trim() ? { identityFile: input.identityFile.trim() } : {}),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  const next = existing ? records.map((r) => (r.id === id ? nextRecord : r)) : [...records, nextRecord];
  await writeRecords(next);
  return toView(nextRecord);
}

export async function startSshTunnel(id: string): Promise<SshTunnelView> {
  if (!SAFE_ID.test(id)) throw new Error("Invalid tunnel ID");
  const records = await readRecords();
  const record = records.find((r) => r.id === id);
  if (!record) throw new Error("Tunnel not found");
  if (!(await commandExists("ssh"))) throw new Error("OpenSSH client is not available on this host");
  await stopSshTunnel(id);

  const argv = buildSshTunnelArgv(record);
  const child = spawn("ssh", argv, { stdio: ["ignore", "ignore", "pipe"] });
  const entry: RunningTunnel = { child, pid: child.pid ?? 0, error: null };
  activeTunnels.set(id, entry);
  child.stderr?.on("data", (chunk: Buffer) => {
    const line = redact(chunk.toString("utf8").trim());
    if (line) entry.error = line.slice(0, 240);
  });
  child.once("exit", (code) => {
    if (code && code !== 0 && !entry.error) entry.error = `ssh exited with code ${code}`;
  });
  return toView(record);
}

export async function stopSshTunnel(id: string): Promise<SshTunnelView | null> {
  const running = activeTunnels.get(id);
  if (running) {
    running.child.kill("SIGTERM");
    activeTunnels.delete(id);
  }
  const records = await readRecords();
  const record = records.find((r) => r.id === id);
  return record ? toView(record) : null;
}

export async function deleteSshTunnel(id: string): Promise<void> {
  await stopSshTunnel(id);
  const records = await readRecords();
  await writeRecords(records.filter((r) => r.id !== id));
}
