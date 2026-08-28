import "server-only";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import type { PackageUpdate, PackageUpdateSummary } from "@/lib/os-api/types";
import { childEnv } from "./child-env";

const execFileAsync = promisify(execFile);
const MAX_UPDATES = 250;
type Manager = NonNullable<PackageUpdateSummary["manager"]>;

const candidates: Array<{ manager: Manager; paths: string[]; args: string[]; accepted?: number[] }> = [
  { manager: "apt", paths: ["/usr/bin/apt", "/bin/apt"], args: ["list", "--upgradable"] },
  { manager: "dnf", paths: ["/usr/bin/dnf", "/bin/dnf"], args: ["-q", "check-update", "--cacheonly"], accepted: [100] },
  { manager: "yum", paths: ["/usr/bin/yum", "/bin/yum"], args: ["-q", "check-update", "-C"], accepted: [100] },
  { manager: "pacman", paths: ["/usr/bin/pacman", "/bin/pacman"], args: ["-Qu"], accepted: [1] },
  { manager: "zypper", paths: ["/usr/bin/zypper", "/bin/zypper"], args: ["--no-refresh", "--non-interactive", "list-updates"], accepted: [100] },
];

function forcedManager(): Manager | null {
  const value = process.env.MSO_PACKAGE_MANAGER;
  return candidates.some((candidate) => candidate.manager === value) ? value as Manager : null;
}

function managerCommand(): { manager: Manager; program: string; args: string[]; accepted: number[] } | null {
  const forced = forcedManager();
  for (const candidate of candidates) {
    if (forced && candidate.manager !== forced) continue;
    const override = process.env[`MSO_${candidate.manager.toUpperCase()}_BIN`];
    const program = override || candidate.paths.find(existsSync);
    if (program) return { ...candidate, program, accepted: candidate.accepted ?? [] };
  }
  return null;
}

export function parseAptUpdates(stdout: string): PackageUpdate[] {
  const updates: PackageUpdate[] = [];
  for (const line of stdout.split("\n")) {
    if (!line || line.startsWith("Listing") || !line.includes("/")) continue;
    const match = line.match(/^([^/\s]+)\/\S+\s+(\S+)\s+(\S+)(?:\s+\[upgradable from: ([^\]]+)\])?/);
    if (!match) continue;
    updates.push({ name: match[1], candidate: match[2], architecture: match[3], ...(match[4] ? { current: match[4] } : {}) });
  }
  return updates;
}

export function parseRpmUpdates(stdout: string): PackageUpdate[] {
  const updates: PackageUpdate[] = [];
  for (const raw of stdout.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("Last metadata") || line.startsWith("Obsoleting")) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2 || !parts[0]?.includes(".")) continue;
    const split = parts[0].lastIndexOf(".");
    updates.push({ name: parts[0].slice(0, split), architecture: parts[0].slice(split + 1), candidate: parts[1] });
  }
  return updates;
}

export function parsePacmanUpdates(stdout: string): PackageUpdate[] {
  return stdout.split("\n").map((line) => line.trim()).filter(Boolean).flatMap((line) => {
    const match = line.match(/^(\S+)\s+(\S+)\s+->\s+(\S+)/);
    return match ? [{ name: match[1], current: match[2], candidate: match[3] }] : [];
  });
}

export function parseZypperUpdates(stdout: string): PackageUpdate[] {
  const updates: PackageUpdate[] = [];
  for (const raw of stdout.split("\n")) {
    const cols = raw.split("|").map((part) => part.trim());
    if (cols.length < 5 || !cols[1] || cols[1] === "Name" || /^[-+]+$/.test(cols[1])) continue;
    updates.push({ name: cols[1], current: cols[2] || undefined, candidate: cols[3], architecture: cols[4] || undefined });
  }
  return updates;
}

function parse(manager: Manager, stdout: string): PackageUpdate[] {
  if (manager === "apt") return parseAptUpdates(stdout);
  if (manager === "dnf" || manager === "yum") return parseRpmUpdates(stdout);
  if (manager === "pacman") return parsePacmanUpdates(stdout);
  return parseZypperUpdates(stdout);
}

export async function packageUpdates(): Promise<PackageUpdateSummary> {
  const command = managerCommand();
  const checkedAt = new Date().toISOString();
  if (!command) return { manager: null, available: false, updates: [], truncated: false, checkedAt, source: "local-cache", diagnostic: "No supported package manager found" };
  try {
    const result = await execFileAsync(command.program, command.args, {
      env: childEnv() as NodeJS.ProcessEnv,
      timeout: 20_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    const updates = parse(command.manager, result.stdout);
    return { manager: command.manager, available: true, updates: updates.slice(0, MAX_UPDATES), truncated: updates.length > MAX_UPDATES, checkedAt, source: "local-cache" };
  } catch (error) {
    const e = error as NodeJS.ErrnoException & { code?: number; stdout?: string; stderr?: string };
    if (typeof e.code === "number" && command.accepted.includes(e.code)) {
      const updates = parse(command.manager, e.stdout || "");
      return { manager: command.manager, available: true, updates: updates.slice(0, MAX_UPDATES), truncated: updates.length > MAX_UPDATES, checkedAt, source: "local-cache" };
    }
    return {
      manager: command.manager,
      available: false,
      updates: [],
      truncated: false,
      checkedAt,
      source: "local-cache",
      diagnostic: (e.stderr || e.message || "Package update check failed").trim().slice(0, 320),
    };
  }
}
