// Host-owned runtime data is not a build asset; tracing exclusions preserve runtime guards.
import "server-only";
import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

const MAX_OUTPUT = 128 * 1024;

/**
 * Directories that hold per-user CLIs but are absent from a systemd unit's PATH.
 *
 * Both upstream installers put their launcher in `~/.local/bin` — Hermes' own
 * installer even prints "`/home/<user>/.local/bin` is not on your PATH" while
 * doing it. systemd gives a unit
 * `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin` and nothing else, so `which
 * hermes` inside mso.service fails on a host where `hermes` plainly works in a
 * terminal.
 */
const FALLBACK_BIN_DIRS = [".local/bin", ".bun/bin"] as const;

export interface ProgramResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * @param env extra variables merged over this process's environment. Used to hand
 *   a child the user-bus address a systemd system unit never inherits
 *   (see `user-bus.ts`); `undefined` leaves the environment untouched.
 */
export function runProgram(
  command: string,
  args: readonly string[],
  timeout = 30_000,
  env?: Record<string, string>,
): Promise<ProgramResult> {
  return new Promise((resolve) => {
    execFile(
      command,
      [...args],
      {
        timeout,
        maxBuffer: MAX_OUTPUT,
        windowsHide: true,
        shell: false,
        // Merge, never replace: the child still needs PATH, HOME and the locale.
        // NOT widened globally: `runProgram` also spawns systemctl/docker, and
        // silently adding a user-writable dir to every child's PATH would both
        // create a shadowing hazard and defeat the PATH-narrowing that
        // update.test.ts relies on to keep tests off the real CLIs.
        ...(env ? { env: { ...process.env, ...env } } : {}),
      },
      (error, stdout, stderr) => {
        const code = typeof error?.code === "number" ? error.code : error ? 1 : 0;
        resolve({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
      },
    );
  });
}

/** `$HOME` first so a caller (and a test) can redirect it; homedir() is the fallback. */
const userHome = (): string => process.env.HOME || homedir();

const isExecutable = (candidate: string): boolean => {
  try {
    accessSync(/* turbopackIgnore: true */ candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/**
 * Absolute path of a CLI, or `null` when it genuinely is not installed.
 *
 * Resolving to a path rather than trusting PATH means the binary that gets
 * *detected* is the same one that later gets *run*, and that a unit's narrow PATH
 * cannot make an installed app look missing.
 */
export async function resolveCommand(command: string): Promise<string | null> {
  // Already a path: nothing to search for.
  if (command.includes("/")) return isExecutable(command) ? command : null;

  const probe = process.platform === "win32" ? "where" : "which";
  const result = await runProgram(probe, [command], 5_000);
  const first = result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  if (result.code === 0 && first && isAbsolute(first)) return first;

  // PATH missed it — look where these CLIs actually install themselves before
  // concluding the app is absent.
  for (const dir of FALLBACK_BIN_DIRS) {
    const candidate = join(/* turbopackIgnore: true */ userHome(), dir, command);
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

export async function commandExists(command: string): Promise<boolean> {
  return (await resolveCommand(command)) !== null;
}

export async function requireProgram(command: string, args: readonly string[], timeout?: number): Promise<void> {
  const result = await runProgram(command, args, timeout);
  if (result.code !== 0) throw new Error("managed application operation failed");
}
