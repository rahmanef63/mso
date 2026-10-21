// The single place where "auto: true" becomes a real timer.
//
// No `server-only`, no Next-only import: the Settings route and the nightly entry
// point (scripts/self-update-auto.ts) both call this, so the browser and the CLI
// cannot install different units or disagree about what "enabled" means.
import { readAutoUpdateState, type AutoUpdateState } from "../prefs/auto-update-state";
import { readPrefs, writePrefs } from "../prefs/store";
import { resolveUpdates, type PrefUpdates, type UpdateChannel } from "../prefs/updates";
import { automaticUpdateReason, execRunner, updateLogPath } from "./update-host-support";
import { installTimer, readTimerState, realTimerIo, removeTimer, type TimerState } from "./self-update-timer";
import { HostError } from "./host-error";

export interface AutomationState {
  prefs: PrefUpdates;
  timer: TimerState;
  /** True only when the pref AND the installed, enabled timer agree. The UI shows
   *  this — never `prefs.auto` alone, which would claim "on" for a deleted unit. */
  active: boolean;
  last: AutoUpdateState;
  /** Set when the two disagree, so the panel can say what is wrong. */
  drift: string | null;
}

export interface AutomationPatch {
  auto?: boolean;
  channel?: UpdateChannel;
}

/** `root` is the checkout the timer builds. Explicit so the CLI can pass the
 *  service checkout even when it is invoked from somewhere else. */
export interface AutomationContext {
  root: string;
}

export async function readAutomationState(): Promise<AutomationState> {
  const prefs = resolveUpdates((await readPrefs()).updates);
  const [timer, last] = await Promise.all([readTimerState(), readAutoUpdateState()]);
  const active = prefs.auto && timer.installed && timer.enabled;
  const drift = prefs.auto && !active
    ? timer.installed
      ? "the nightly update timer is installed but not enabled — toggle it off and on to re-enable it"
      : "automatic updates are enabled in preferences but the timer is missing on this host — toggle it off and on to reinstall it"
    : !prefs.auto && timer.active
      ? "a nightly update timer is still scheduled although automatic updates are off — run mso update --auto off"
      : null;
  return { prefs, timer, active, last, drift };
}

/**
 * Apply an owner patch. Refuses the whole change when this host cannot host a
 * timer, rather than storing `auto: true` for a scheduler that will never exist.
 */
export async function applyAutomation(patch: AutomationPatch, ctx: AutomationContext): Promise<AutomationState> {
  const current = resolveUpdates((await readPrefs()).updates);
  const next: PrefUpdates = { ...current, ...patch };
  const io = realTimerIo();

  if (next.auto) {
    const reason = await automaticUpdateReason(execRunner);
    if (reason) throw new HostError(`automatic updates are unavailable: ${reason}`);
    const installed = await installTimer(ctx.root, updateLogPath(), io);
    if (!installed.ok) throw new HostError(installed.error);
  } else if (current.auto || patch.auto === false) {
    // Unconditional on an explicit `off`: this is also how an operator clears the
    // drift where a timer survived a pref that already says false.
    const removed = await removeTimer(io);
    if (!removed.ok) throw new HostError(removed.error);
  }
  // A channel change needs no timer action: the unit reads the channel from prefs
  // at run time, so the very next night already uses it.

  await writePrefs({ updates: next });
  return readAutomationState();
}
