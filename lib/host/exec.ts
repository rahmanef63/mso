// SERVER-ONLY. One-shot shell runner behind /api/v1/exec/run. Non-interactive:
// captured stdout/stderr + exit code, bounded time + output. cwd is constrained
// to the WRITE roots (falls back to home). The command itself is the
// session-authenticated owner's responsibility (this is a VPS-control OS — RCE
// for the owner is the point; the gate is the signed-cookie + approved device).
import { exec } from "child_process";
import path from "path";
import { promises as fs } from "fs";
import type { ExecResult } from "@/lib/os-api/types";
import { HostError } from "./host-error";
import { homeDir, isUnderRoot, resolveWriteRoots } from "./paths";
import { childEnv } from "./child-env";
import { matchDestructive } from "./destructive-patterns";

const TIMEOUT_MS = 30_000;
const MAX_OUTPUT = 1_000_000; // 1 MiB per stream

// Live exec runs on whatever host serves MSO: bash on the Linux VPS (or
// macOS), the platform shell on Windows (local dev). Hardcoding /bin/bash broke
// EVERY command when the cockpit ran on a non-Linux host — so the shell tracks
// the actual server connection (vps vs local).
const SHELL = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "/bin/bash";

// Returns the reason a command is refused, or null when it may run. The
// catastrophic-command patterns live in the isomorphic `destructive-patterns`
// module (shared with the assistant's approval card so it can flag a doomed
// command before the human approves it); the env override stays server-side.
export function destructiveReason(cmd: string): string | null {
  if (process.env.OS_EXEC_ALLOW_DESTRUCTIVE === "1") return null;
  return matchDestructive(cmd);
}

// Shared with the PTY manager (pty.ts): same write-root bound, same fall-home.
export async function resolveCwd(requested?: string): Promise<string> {
  const home = homeDir();
  if (!requested || requested === "~") return home;
  const absolute = requested.startsWith("~/")
    ? path.join(home, requested.slice(2))
    : path.resolve(requested);
  let real: string;
  try {
    real = await fs.realpath(absolute);
  } catch {
    return home; // cwd gone → fall back home rather than fail the command
  }
  const roots = await resolveWriteRoots();
  return roots.some((r) => isUnderRoot(real, r)) ? real : home;
}

export async function runCommand(cmd: string, cwd?: string, artifactEnv: Record<string, string> = {}): Promise<ExecResult> {
  if (typeof cmd !== "string" || !cmd.trim()) throw new HostError("Empty command");
  const blocked = destructiveReason(cmd);
  if (blocked) {
    return {
      stdout: "",
      stderr: `refused: ${blocked}. Run it over SSH if you really mean it (or set OS_EXEC_ALLOW_DESTRUCTIVE=1).`,
      code: 126,
    };
  }
  const dir = await resolveCwd(cwd);
  return new Promise<ExecResult>((resolve) => {
    exec(
      cmd,
      // childEnv preserves NODE_ENV (only the app's secrets are stripped), so the
      // ProcessEnv cast is sound — the typed shape just demands NODE_ENV present.
      { cwd: dir, timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT, env: { ...childEnv(), ...artifactEnv } as NodeJS.ProcessEnv, shell: SHELL },
      (err: Error | null, stdout: string, stderr: string) => {
        const e = err as (Error & { code?: number; killed?: boolean }) | null;
        const code = e && typeof e.code === "number" ? e.code : e ? 1 : 0;
        resolve({
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? "") + (e && e.killed ? "\n[timed out after 30s]" : ""),
          code,
        });
      },
    );
  });
}
