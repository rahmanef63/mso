/**
 * Nightly unattended-update PRE-FLIGHT. Exits non-zero only when the run itself is
 * broken; a refusal prints `SKIP <reason>` and exits 0 so systemd does not record a
 * failed unit for a decision that was correct.
 *
 * The decision is made in lib/host/update-decision.ts, with the same facts the
 * Settings panel collects (lib/host/update-facts.ts) — an unattended run must not
 * judge a checkout differently from the button a human is looking at.
 *
 *   bun scripts/self-update-auto.ts                 # decide, record "skipped" on refusal
 *   bun scripts/self-update-auto.ts --record ok|failed [detail]
 *
 * It runs OUTSIDE Next: none of the imported modules carry `server-only`.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readAutoUpdateState, writeAutoUpdateState, type AutoUpdateResult } from "../lib/prefs/auto-update-state";
import { readPrefs } from "../lib/prefs/store";
import { resolveUpdates } from "../lib/prefs/updates";
import { autoUpdateGate } from "../lib/host/update-decision";
import { collectUpdateFacts } from "../lib/host/update-facts";
import { fetchArgs } from "../lib/host/self-update-channel";
import { automaticUpdateReason, execRunner, isUpdateRunning, readUpdateLog } from "../lib/host/update-host-support";
import { prepareUpdateOrigin, updateGitEnv } from "../lib/host/update-remote-authority";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const git = (args: readonly string[], timeoutMs?: number) => execRunner("git", args, timeoutMs, updateGitEnv());

function record(result: AutoUpdateResult, detail: string | null): Promise<unknown> {
  return readAutoUpdateState().then((state) =>
    writeAutoUpdateState({
      lastAttemptAt: Date.now(),
      lastResult: result,
      detail,
      // A skip is not a failure and must not make a paused host look worse; a
      // success clears the pause so the next night runs unattended again.
      consecutiveFailures: result === "failed" ? state.consecutiveFailures + 1 : result === "ok" ? 0 : state.consecutiveFailures,
    }),
  );
}

async function decide(): Promise<number> {
  process.chdir(ROOT);
  const prefs = resolveUpdates((await readPrefs()).updates);

  // A refusal is a sentence somebody has to be able to read a day later.
  const refuse = async (reason: string): Promise<number> => {
    await record("skipped", reason);
    console.log(`SKIP ${reason}`);
    return 0;
  };

  // Cheapest possible exit, and the one that must never touch the network: a timer
  // unit that survived `--auto off` still fires every night.
  if (!prefs.auto) {
    console.log("SKIP automatic updates are turned off");
    return 0;
  }

  // The timer unit lives in the user manager, so a transient update from Settings
  // is the only other writer of the checkout. The setsid fallback is a no-systemd
  // path where this timer does not exist at all.
  const running = await isUpdateRunning(execRunner, async () => false);
  const facts = await collectUpdateFacts({
    git: (args) => git(args),
    channel: prefs.channel,
    fetch: true,
    fetchRemote: async () => {
      const ready = await prepareUpdateOrigin((args) => git(args, 45_000));
      if (!ready) return { code: 1 };
      return git(fetchArgs(prefs.channel), 45_000);
    },
  });
  if (!facts.insideWorkTree) return refuse("this deployment is not a git checkout, so there is nothing to pull");

  const reason = await automaticUpdateReason(execRunner);
  const last = await readAutoUpdateState();
  const gate = autoUpdateGate({
    auto: prefs.auto,
    supported: reason === null,
    reason,
    dirty: facts.dirty,
    running,
    ahead: facts.ahead,
    behind: facts.behind,
    // Deliberately NOT "build is pending": the panel's version of that state compares
    // the running process's baked SHA, which only Next knows. An unattended run exists
    // to pick up new commits; restarting a host every night for a rebuild nobody asked
    // for is not an update, so it waits for the panel or a human.
    pendingBuild: false,
    consecutiveFailures: last.consecutiveFailures,
    changedPaths: facts.changedPaths,
    target: facts.targetLabel,
    targetFallback: facts.targetFallback,
  });

  if (!gate.run) return refuse(gate.reason);

  // The wrapper reads these two machine lines: a decision made here must apply the
  // commit it judged, not whatever `main` moved to in the meantime.
  await writeAutoUpdateState({ channel: prefs.channel });
  console.log(`MSO_AUTO_CHANNEL=${prefs.channel}`);
  console.log(`MSO_AUTO_TARGET_SHA=${facts.targetSha}`);
  if (facts.targetSha === "") return refuse("could not read the resolved update target commit");
  console.log(`RUN ${prefs.channel} ${facts.targetLabel} behind=${facts.behind}`);
  return 0;
}

async function main(): Promise<number> {
  if (process.argv[2] === "--record") {
    const result = process.argv[3];
    if (result !== "ok" && result !== "failed" && result !== "skipped") {
      console.error("usage: self-update-auto.ts --record ok|failed|skipped [detail]");
      return 2;
    }
    if (result === "failed") {
      // The log is truncated on every attempt, so the reason is captured here or not
      // at all. Bounded: it is rendered in a settings row.
      const log = await readUpdateLog();
      const failed = log.split("\n").filter((line) => line.includes("FAILED:")).pop();
      await record("failed", (process.argv[4] || failed || "the unattended build failed; inspect the update log").slice(0, 300));
    } else {
      await record(result, process.argv[4] ?? null);
    }
    return 0;
  }
  return decide();
}

process.exit(await main());
