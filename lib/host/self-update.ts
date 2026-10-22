// Host-owned runtime data is not a build asset; tracing exclusions preserve runtime guards.
import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { HostError } from "./host-error";
import { offlineUpdateArgs, offlineUpdateRunning } from "./self-update-offline";
import { prepareUpdateOrigin, updateGitEnv } from "./update-remote-authority";
import { blockingReason, parseCommits, updateBranchReason, updateRefusal, type UpdateStatus } from "./update-decision";
import { preflightUpdateConflicts } from "./update-conflict";
import { fetchArgs } from "./self-update-channel";
import type { UpdateChannel } from "@/lib/prefs/updates";
import { collectUpdateFacts } from "./update-facts";
import { readPrefs } from "@/lib/prefs/store";
import { resolveUpdates } from "@/lib/prefs/updates";
import {
  AUTO_UPDATE_UNIT,
  SELF_UPDATE_UNIT,
  automaticUpdateReason,
  execRunner,
  isUpdateRunning,
  readUpdateLog,
  updateLogPath,
  type Ran,
} from "./update-host-support";

// SERVER-ONLY. "Is there a newer MSO, and pull it in" — the deploy that CLAUDE.md
// describes (`git pull` → build → restart), driven from Settings instead of from a
// terminal the owner may not have open.
//
// THE UPDATE DOES NOT RUN IN THIS PROCESS, and that is not a style choice: the last
// step replaces the process serving MSO, and systemd's default KillMode kills every
// child in mso.service's cgroup. The job is therefore handed to the OWNER'S
// transient user unit via `systemd-run --user`. That gives it a separate cgroup
// without granting the web app passwordless root. At the end the updater signals
// mso.service's same-UID MainPID; Restart=always brings the system unit back on the
// freshly-built checkout.
//
// The DECISIONS live in ./update-decision and the ref resolution in
// ./self-update-channel, both free of Next-only imports, because the nightly timer
// (scripts/self-update-auto.ts) must refuse on exactly the same facts.

export type { UpdateCommit, UpdateStatus } from "./update-decision";
export { blockingReason, parseCommits, updateBranchReason, updateRefusal };
export type { UpdateRefusal } from "./update-decision";
export { updateConflictPrompt, preflightUpdateConflicts } from "./update-conflict";
export type { UpdateConflictReport } from "./update-conflict";
export { AUTO_UPDATE_UNIT, SELF_UPDATE_UNIT };
export type { UpdateChannel };

const GIT_TIMEOUT_MS = 20_000;
const FETCH_TIMEOUT_MS = 45_000;

const repoRoot = (): string => process.cwd();

/**
 * Arguments are pure/testable because this boundary is security-sensitive: a
 * request may choose only rebuild vs update, and the CHANNEL is the stored enum —
 * never a ref, path, tag or command. `--channel=` carries the two-word value; the
 * updater re-validates it and resolves the actual Git ref itself.
 */
export function updateUnitArgs(
  root: string,
  logPath: string,
  rebuildOnly = false,
  channel: UpdateChannel = "stable",
): string[] {
  return [
    "--user",
    "--collect",
    `--unit=${SELF_UPDATE_UNIT}`,
    `--property=WorkingDirectory=${root}`,
    // A build on a small VPS is minutes, not seconds; the default 90s start
    // timeout would kill it exactly at the point of no return.
    "--property=TimeoutStartSec=3600",
    `--setenv=MSO_UPDATE_LOG=${logPath}`,
    "/bin/bash",
    path.join(root, "scripts", "mso-service-update"),
    `--channel=${channel === "main" ? "main" : "stable"}`,
    ...(rebuildOnly ? ["--rebuild-only"] : []),
  ];
}

/** `git` with the non-interactive remote policy. The authority module is plain
 *  data (no Next import), so both the panel and the timer use the same env. */
const git = (args: readonly string[], timeout = GIT_TIMEOUT_MS) =>
  execRunner("git", args, timeout, updateGitEnv());

/**
 * @param fetchRemote when true, ask the remote first. A check costs a network
 *   round trip, so the panel asks for one and the poller during an update does not.
 * @param channel override; defaults to the owner's stored pref.
 */
export async function getUpdateStatus(fetchRemote = true, channel?: UpdateChannel): Promise<UpdateStatus> {
  const buildSha = (process.env.NEXT_PUBLIC_COMMIT_SHA ?? "").trim();
  // Read ONCE: the panel polls this every 3s while a build runs, and the log is
  // the biggest thing in the response.
  const log = await readUpdateLog();
  const effective = channel ?? resolveUpdates((await readPrefs()).updates).channel;
  const base: UpdateStatus = {
    supported: false, reason: null, current: "unknown", currentSubject: "", buildSha,
    pendingBuild: false, ahead: 0, behind: 0, commits: [], dirty: false,
    running: false, remoteChecked: false, log, channel: effective,
    target: "origin/main", targetFallback: false,
  };

  // `git` needs the remote credentials policy for fetch only; reads are local.
  const running = await isUpdateRunning(execRunner, offlineUpdateRunning);
  const facts = await collectUpdateFacts({
    git: (args) => git(args),
    channel: effective,
    fetch: fetchRemote && !running,
    fetchRemote: async () => {
      const ready = await prepareUpdateOrigin((args) => git(args, FETCH_TIMEOUT_MS));
      if (!ready) return { code: 1 };
      return git(fetchArgs(effective), FETCH_TIMEOUT_MS);
    },
  });
  if (!facts.insideWorkTree) {
    return { ...base, reason: "this deployment is not a git checkout, so there is nothing to pull", running };
  }

  const reason = await automaticUpdateReason(execRunner);
  const ahead = facts.ahead;
  const dirty = facts.dirty;
  // READ-ONLY preflight, and only in the two states the operator can be in by
  // choice. `git merge-tree --write-tree` computes the merge in memory: no index,
  // worktree or HEAD write, so this GET route still never mutates the repository.
  const diverged = ahead > 0 && facts.behind > 0;
  const conflict = dirty || diverged
    ? await preflightUpdateConflicts({ targetRef: facts.targetRef, runner: (args) => git(args) })
    : null;
  return {
    ...base,
    supported: reason === null,
    reason,
    current: facts.head,
    latest: facts.latest,
    currentSubject: facts.subject,
    // Only when we know both: a build with no sha baked in (an archive export, a
    // dev server) must not be reported as permanently stale.
    pendingBuild: Boolean(buildSha) && facts.head !== "unknown" && !buildSha.startsWith(facts.head) && !facts.head.startsWith(buildSha),
    ahead,
    behind: facts.behind,
    commits: facts.commits,
    dirty,
    running,
    remoteChecked: facts.remoteChecked,
    log,
    channel: effective,
    target: facts.targetLabel,
    targetFallback: facts.targetFallback,
    ...(conflict ? { conflict } : {}),
  };
}

/**
 * Hand the update to a transient systemd unit and return immediately.
 *
 * Nothing from the request reaches a shell: the only knobs are a boolean and the
 * stored channel enum, and the ref is resolved server-side.
 */
export async function startUpdate(rebuildOnly = false, channel?: UpdateChannel): Promise<UpdateStatus> {
  const effective = channel ?? resolveUpdates((await readPrefs()).updates).channel;
  const status = await getUpdateStatus(true, effective);
  const blocked = blockingReason(status, rebuildOnly);
  if (blocked) throw new HostError(blocked);

  const userManager = await execRunner("systemctl", ["--user", "show-environment"], 10_000);
  let started: Ran;
  if (userManager.code === 0) {
    const script = path.join(repoRoot(), "scripts", "mso-service-update");
    if (!(await fs.stat(script).catch(() => null))) throw new HostError(`missing ${script}`);
    started = await execRunner("systemd-run", updateUnitArgs(repoRoot(), updateLogPath(), rebuildOnly, effective), 30_000);
  } else {
    const script = path.join(repoRoot(), "scripts", "mso-offline-update-job");
    if (!(await fs.stat(script).catch(() => null))) throw new HostError(`missing ${script}`);
    // The wrapper writes its PID before doing any mutation and redirects stdout/
    // stderr to the same log the panel already polls. setsid receives only a
    // compile-time script path and the one allowed boolean flag; the wrapper reads
    // the channel from the same preference file this function just read.
    started = await execRunner("setsid", offlineUpdateArgs(repoRoot(), rebuildOnly), 30_000);
  }
  if (started.code !== 0) {
    throw new HostError(
      `could not start the updater: ${(started.stderr || started.stdout).trim().slice(0, 300) || `exit ${started.code}`}`,
    );
  }
  return { ...status, running: true };
}
