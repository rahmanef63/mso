// The nightly timer's unit files and their REAL state.
//
// Where the units ship: written at runtime by this module, not by the installer.
// The installer already enables linger and hands mso.service a user bus, so the web
// app can do this without sudo; install-core.sh is also at its line ratchet. The
// consequence is that the UI must read the manager's state rather than the pref —
// a pref saying "auto" with no unit file is not an enabled host.
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { AUTO_UPDATE_UNIT, type Ran, type Runner, execRunner } from "./update-host-support";

export interface TimerState {
  installed: boolean;
  enabled: boolean;
  active: boolean;
  /** ISO date of the next elapse, or null when the timer is not scheduled. */
  nextRun: string | null;
}

const DISABLED: TimerState = { installed: false, enabled: false, active: false, nextRun: null };

/** `$XDG_CONFIG_HOME/systemd/user`, else `~/.config/systemd/user`. */
export function unitDir(): string {
  const base = process.env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), ".config");
  return process.env.MSO_SYSTEMD_USER_DIR?.trim() || path.join(base, "systemd", "user");
}

export const unitPaths = (): { service: string; timer: string } => {
  const dir = unitDir();
  return { service: path.join(dir, `${AUTO_UPDATE_UNIT}.service`), timer: path.join(dir, `${AUTO_UPDATE_UNIT}.timer`) };
};

/** systemd exec arguments are space-split with quote support; a checkout path with
 *  a space must survive as ONE argument, so quote and escape rather than join raw. */
const exec = (value: string): string => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** Pure: unit text for a given checkout. No request value reaches this string. */
export function unitFiles(root: string, logPath: string): { service: string; timer: string } {
  const service = `[Unit]
Description=MSO unattended self-update (the pre-flight decides whether anything changes)

[Service]
Type=oneshot
WorkingDirectory=${exec(root)}
Environment=MSO_UPDATE_LOG=${exec(logPath)}
# A build on a small VPS is minutes. The transient update unit already has its own
# 1h start timeout; this is the outer bound for pre-flight + that wait.
TimeoutStartSec=5400
ExecStart=/bin/bash ${exec(path.join(root, "scripts", "mso-auto-update"))}
`;
  const timer = `[Unit]
Description=MSO nightly unattended self-update

[Timer]
# Nightly, jittered, and caught up after downtime. Never a fixed minute on every
# host: every MSO deployment would otherwise fetch the same commit together.
OnCalendar=*-*-* 04:30:00
RandomizedDelaySec=25m
Persistent=true
Unit=${AUTO_UPDATE_UNIT}.service

[Install]
WantedBy=timers.target
`;
  return { service, timer };
}

/** True only when the manager actually knows the timer unit. */
export async function readTimerState(run: Runner = execRunner): Promise<TimerState> {
  const [installed, enabled, active] = await Promise.all([
    run("systemctl", ["--user", "show", "-p", "LoadState", "--value", `${AUTO_UPDATE_UNIT}.timer`], 10_000),
    run("systemctl", ["--user", "is-enabled", `${AUTO_UPDATE_UNIT}.timer`], 10_000),
    run("systemctl", ["--user", "is-active", `${AUTO_UPDATE_UNIT}.timer`], 10_000),
  ]);
  if (installed.code !== 0 || installed.stdout.trim() !== "loaded") return { ...DISABLED };
  const next = await run("systemctl", ["--user", "show", "-p", "NextElapseUSecRealtime", "--value", `${AUTO_UPDATE_UNIT}.timer`], 10_000);
  const raw = next.code === 0 ? next.stdout.trim() : "";
  // systemd prints `n/a` for a timer that is loaded but not scheduled.
  return {
    installed: true,
    enabled: enabled.code === 0 && enabled.stdout.trim() === "enabled",
    active: active.code === 0 && active.stdout.trim() === "active",
    nextRun: raw && raw !== "n/a" ? raw : null,
  };
}

export interface TimerMutation {
  run: Runner;
  /** Injected so tests exercise the decision without touching a real manager. */
  writeFile: (file: string, content: string) => Promise<void>;
  removeFile: (file: string) => Promise<void>;
  mkdir: (dir: string) => Promise<void>;
}

/** Production IO: real user-manager calls and 0600 unit files. */
export const realTimerIo = (): TimerMutation => ({
  run: execRunner,
  mkdir: async (dir) => {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  },
  writeFile: async (file, content) => {
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, content, { encoding: "utf8", mode: 0o600 });
    await fs.rename(tmp, file);
  },
  removeFile: async (file) => {
    await fs.rm(file, { force: true });
  },
});

const reload = async (run: Runner): Promise<Ran> => run("systemctl", ["--user", "daemon-reload"], 20_000);

/** Write both units, then enable the timer. Throws nothing: the caller decides. */
export async function installTimer(
  root: string,
  logPath: string,
  io: TimerMutation,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const files = unitFiles(root, logPath);
  const paths = unitPaths();
  try {
    await io.mkdir(unitDir());
    await io.writeFile(paths.service, files.service);
    await io.writeFile(paths.timer, files.timer);
  } catch (cause) {
    return { ok: false, error: `could not write the update timer units: ${String(cause).slice(0, 200)}` };
  }
  const reloaded = await reload(io.run);
  if (reloaded.code !== 0) {
    return { ok: false, error: `systemd --user daemon-reload failed: ${(reloaded.stderr || reloaded.stdout).trim().slice(0, 200)}` };
  }
  const enabled = await io.run("systemctl", ["--user", "enable", "--now", `${AUTO_UPDATE_UNIT}.timer`], 30_000);
  if (enabled.code !== 0) {
    return { ok: false, error: `could not enable the update timer: ${(enabled.stderr || enabled.stdout).trim().slice(0, 200)}` };
  }
  return { ok: true };
}

/** Disable and delete. Missing units are already "off", not an error. */
export async function removeTimer(io: TimerMutation): Promise<{ ok: true } | { ok: false; error: string }> {
  await io.run("systemctl", ["--user", "disable", "--now", `${AUTO_UPDATE_UNIT}.timer`], 30_000);
  // Stopping the oneshot is best-effort: a run already past its pre-flight owns the
  // update lock and will finish the build it started.
  await io.run("systemctl", ["--user", "stop", `${AUTO_UPDATE_UNIT}.service`], 30_000);
  const paths = unitPaths();
  await io.removeFile(paths.timer).catch(() => undefined);
  await io.removeFile(paths.service).catch(() => undefined);
  const reloaded = await reload(io.run);
  if (reloaded.code !== 0) {
    return { ok: false, error: `systemd --user daemon-reload failed: ${(reloaded.stderr || reloaded.stdout).trim().slice(0, 200)}` };
  }
  return { ok: true };
}

export { AUTO_UPDATE_UNIT };
