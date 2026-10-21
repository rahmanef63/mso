/**
 * `mso update --auto on|off` / `--channel stable|main` / the automation block of
 * `mso update status`, implemented by calling the SAME lib/host/update-automation
 * module the Settings UI calls. The CLI does not re-implement unit installation or
 * the pref file: two implementations of "enabled" is how a host ends up with a
 * timer nobody knows about.
 *
 *   bun scripts/mso-update-automation.ts status [--brief]
 *   bun scripts/mso-update-automation.ts auto on|off
 *   bun scripts/mso-update-automation.ts channel stable|main
 *   bun scripts/mso-update-automation.ts resume   # clear the 2-failure pause
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyAutomation, readAutomationState } from "../lib/host/update-automation";
import { clearAutoUpdatePause } from "../lib/prefs/auto-update-state";
import { parseUpdateChannel } from "../lib/prefs/updates";
import { HostError } from "../lib/host/host-error";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const brief = process.argv.includes("--brief");

const when = (at: number | null): string =>
  at ? new Date(at).toISOString().replace("T", " ").slice(0, 19) + "Z" : "never";

function print(state: Awaited<ReturnType<typeof readAutomationState>>): void {
  const { prefs, timer, active, last, drift } = state;
  if (brief) {
    console.log(`auto: ${active ? "on" : "off"} (channel ${prefs.channel}${prefs.auto && !active ? ", timer missing" : ""})`);
    console.log(`last attempt: ${when(last.lastAttemptAt)} — ${last.lastResult ?? "none"}${last.detail ? ` (${last.detail})` : ""}`);
    return;
  }
  console.log(`automatic updates   ${active ? "on" : "off"}${prefs.auto && !active ? "  (preference is on, timer is not)" : ""}`);
  console.log(`channel             ${prefs.channel}${prefs.channel === "stable" ? "  (newest release tag reachable from origin/main)" : "  (rolling origin/main)"}`);
  console.log(`nightly timer       ${timer.installed ? (timer.enabled ? "installed + enabled" : "installed, not enabled") : "not installed"}`);
  if (timer.nextRun) console.log(`next run            ${timer.nextRun}`);
  console.log(`last attempt        ${when(last.lastAttemptAt)} — ${last.lastResult ?? "none"}`);
  if (last.detail) console.log(`last detail         ${last.detail}`);
  if (last.consecutiveFailures >= 2) console.log("paused              after 2 consecutive failed builds; run mso update from a terminal");
  if (drift) console.log(`warning             ${drift}`);
}

async function main(): Promise<number> {
  process.chdir(ROOT);
  const [action, value] = process.argv.slice(2);
  try {
    if (!action || action === "status") {
      print(await readAutomationState());
      return 0;
    }
    if (action === "auto") {
      if (value !== "on" && value !== "off") {
        console.error("usage: mso update --auto on|off");
        return 2;
      }
      print(await applyAutomation({ auto: value === "on" }, { root: ROOT }));
      return 0;
    }
    if (action === "resume") {
      // Called by `mso update` right before it applies an update by hand. The gate
      // stops after two consecutive failed builds and tells the operator to run that
      // command; without this the advice could never actually unpause the timer.
      await clearAutoUpdatePause();
      return 0;
    }
    if (action === "channel") {
      const channel = parseUpdateChannel(value);
      if (!channel) {
        console.error("usage: mso update --channel stable|main");
        return 2;
      }
      print(await applyAutomation({ channel }, { root: ROOT }));
      return 0;
    }
    console.error("usage: mso-update-automation.ts status|auto on|off|channel stable|main");
    return 2;
  } catch (cause) {
    // HostError messages are written for an operator ("the nightly update timer is
    // missing…"); anything else is a bug and must not read like advice.
    console.error(`mso update: ${cause instanceof HostError ? cause.message : String(cause).slice(0, 300)}`);
    return 1;
  }
}

process.exit(await main());
