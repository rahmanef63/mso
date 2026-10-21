// Read-only view of unattended-update state. Written ONLY by the updater
// (scripts/self-update-auto.ts) — never by an HTTP client, which is why it lives
// beside prefs.json instead of inside it. A client that could set `lastResult`
// could make a broken host read "ok".
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { UpdateChannel } from "./updates";

export type AutoUpdateResult = "ok" | "failed" | "skipped";

export interface AutoUpdateState {
  lastAttemptAt: number | null;
  lastResult: AutoUpdateResult | null;
  /** Grows per failed unattended run and is reset by any success. The gate pauses
   *  at 2 — the update log is truncated on every attempt, so the count cannot be
   *  recovered from it after the fact. */
  consecutiveFailures: number;
  /** Human sentence for the last skip/failure, shown next to the result. */
  detail: string | null;
  channel: UpdateChannel | null;
}

export const AUTO_UPDATE_STATE_DEFAULTS: AutoUpdateState = {
  lastAttemptAt: null,
  lastResult: null,
  consecutiveFailures: 0,
  detail: null,
  channel: null,
};

const statePath = (): string => {
  const override = process.env.MSO_AUTO_UPDATE_STATE?.trim();
  return override || path.join(os.homedir(), ".mso", "auto-update-state.json");
};

const RESULTS = new Set<AutoUpdateResult>(["ok", "failed", "skipped"]);

export async function readAutoUpdateState(): Promise<AutoUpdateState> {
  try {
    const raw = JSON.parse(await fs.readFile(/* turbopackIgnore: true */ statePath(), "utf8")) as Record<string, unknown>;
    const attempts = Number(raw.consecutiveFailures);
    return {
      lastAttemptAt: Number.isSafeInteger(raw.lastAttemptAt) ? (raw.lastAttemptAt as number) : null,
      lastResult: RESULTS.has(raw.lastResult as AutoUpdateResult) ? (raw.lastResult as AutoUpdateResult) : null,
      consecutiveFailures: Number.isSafeInteger(attempts) && attempts >= 0 ? attempts : 0,
      detail: typeof raw.detail === "string" ? raw.detail.slice(0, 300) : null,
      channel: raw.channel === "stable" || raw.channel === "main" ? raw.channel : null,
    };
  } catch {
    return { ...AUTO_UPDATE_STATE_DEFAULTS };
  }
}

export async function writeAutoUpdateState(patch: Partial<AutoUpdateState>): Promise<AutoUpdateState> {
  const next = { ...(await readAutoUpdateState()), ...patch };
  const file = statePath();
  await fs.mkdir(/* turbopackIgnore: true */ path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600 });
  await fs.rename(tmp, file);
  return next;
}

/**
 * Clear the unattended pause when an operator starts an update by hand.
 *
 * `autoUpdateGate` stops after two consecutive failed builds and tells the operator
 * to inspect the log and run `mso update` from a terminal. Without this reset that
 * advice was false: the streak only cleared on a SUCCESSFUL unattended run, which
 * could never happen while the gate was refusing. The count is left at zero rather
 * than 1 so a single new failure does not re-pause immediately — the operator has
 * just looked at the machine.
 *
 * Deliberately does not touch `lastResult`/`detail`: those are evidence of what
 * happened, and a manual attempt that later fails will overwrite them itself.
 */
export async function clearAutoUpdatePause(): Promise<void> {
  const current = await readAutoUpdateState();
  if (current.consecutiveFailures === 0) return;
  await writeAutoUpdateState({ consecutiveFailures: 0 });
}
