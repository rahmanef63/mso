// The update DECISIONS, with no I/O: what `git` said (parseCommits), whether a
// checkout may update at all (updateBranchReason / blockingReason), and whether an
// UNATTENDED run may proceed (autoUpdateGate).
//
// This module is deliberately free of `server-only` and `@/` imports: the timer's
// pre-flight (scripts/self-update-auto.ts) runs it under bun, outside Next.
import type { UpdateChannel } from "../prefs/updates";
import type { UpdateConflictReport } from "./update-conflict";

export interface UpdateCommit {
  sha: string;
  subject: string;
  date: string;
}

export interface UpdateStatus {
  /** False when this deployment cannot self-update (for example, not a checkout or no safe handoff runtime). */
  supported: boolean;
  /** Why not, when `supported` is false — shown to the operator verbatim. */
  reason: string | null;
  /** HEAD of the CHECKOUT — what a rebuild would compile. */
  current: string;
  currentSubject: string;
  /** Latest commit of the RESOLVED target (origin/main, or a release tag), independent of restart support. */
  latest?: string;
  /** The commit the RUNNING build was compiled from (baked in by next.config), or
   *  "" when the build carried no .git. Differs from `current` whenever someone
   *  pulled without rebuilding — the state the panel calls "a build is pending". */
  buildSha: string;
  pendingBuild: boolean;
  ahead: number;
  behind: number;
  commits: UpdateCommit[];
  /** Uncommitted work in the checkout: a `--ff-only` merge would fail, so refuse early. */
  dirty: boolean;
  running: boolean;
  /** False when `git fetch` could not reach the remote — `behind` is then only local knowledge. */
  remoteChecked: boolean;
  log: string;
  /** Which channel produced this comparison. Optional so older fixtures stay valid. */
  channel?: UpdateChannel;
  /** Server-resolved target label (`origin/main`, `v1.2.3`, …). Never a request value. */
  target?: string;
  /** Stable found no release tag at all and is tracking rolling main — said out loud. */
  targetFallback?: boolean;
  /** Read-only merge preflight, present only when the checkout is dirty or diverged.
   *  Absent means "not investigated", never "safe". */
  conflict?: UpdateConflictReport;
}

/** `<sha>\x1f<subject>\x1f<iso date>` per line — a separator no subject can contain. */
export function parseCommits(stdout: string): UpdateCommit[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 25)
    .map((line) => {
      const [sha = "", subject = "", date = ""] = line.split("\x1f");
      return { sha, subject: subject.slice(0, 200), date: date.slice(0, 10) };
    })
    .filter((c) => c.sha);
}

export function updateBranchReason(branch: string): string | null {
  const current = branch.trim();
  return current === "main"
    ? null
    : `software updates require the checkout to be on main (current: ${current || "detached HEAD"})`;
}

/**
 * Why this update must not start, or `null` when it may.
 *
 * Pure, and separate from the doing, because every one of these is a refusal an
 * operator has to be able to read — "nothing happened and here is why" beats a
 * build that fails halfway through with the live `.next` already deleted.
 */
export function blockingReason(status: UpdateStatus, rebuildOnly: boolean): string | null {
  return updateRefusal(status, rebuildOnly).reason;
}

/** A refusal plus — for the two states a user can actually be in by choice, a dirty
 *  tree and a diverged main — the read-only preflight that names the files. The
 *  `reason` string is unchanged for every existing caller; `conflict` is extra. */
export type UpdateRefusal = {
  reason: string | null;
  /** Only when the checkout is dirty or diverged AND a preflight ran. */
  conflict: UpdateConflictReport | null;
};

const NAME_LIMIT = 8;

function names(files: readonly string[]): string {
  const shown = files.slice(0, NAME_LIMIT).join(", ");
  return files.length > NAME_LIMIT ? `${shown} (+${files.length - NAME_LIMIT} more)` : shown;
}

export function updateRefusal(status: UpdateStatus, rebuildOnly: boolean): UpdateRefusal {
  const target = status.target ?? "origin/main";
  if (!status.supported) return { reason: status.reason ?? "this deployment cannot update itself", conflict: null };
  if (status.running) return { reason: "an update is already running", conflict: null };
  const conflict = status.conflict ?? null;
  if (status.dirty) {
    // Same sentence and same leading words as before (the Settings panel keys its
    // "dirty" remedy off "uncommitted changes"), now followed by what the preflight
    // actually found: either the exact colliding files or what carries over.
    const base = "the checkout has uncommitted changes — commit or stash them on the host first, a fast-forward would refuse anyway";
    if (!conflict) return { reason: base, conflict };
    const detail = conflict.safe
      ? `; a read-only preflight found no conflict, so these changes would carry over cleanly: ${names(conflict.carried) || "none"}`
      : `; a read-only preflight found conflicts in: ${names(conflict.conflicted.length ? conflict.conflicted : conflict.overlap)}`;
    return { reason: `${base}${detail}`, conflict };
  }
  if (!rebuildOnly && status.ahead > 0) {
    const detail = conflict && !conflict.safe
      ? `; files behind the divergence: ${names(conflict.conflicted.length ? conflict.conflicted : conflict.overlap)}`
      : "";
    return {
      reason: status.behind > 0
        ? `local main has diverged from ${target} (ahead ${status.ahead}, behind ${status.behind}); reconcile it before updating${detail}`
        : `local main is ahead of ${target} by ${status.ahead} commit(s); push or reconcile it before updating`,
      conflict,
    };
  }
  // `pendingBuild` is a reason to run even with nothing to pull: the checkout
  // already holds code the running process was not built from, and refusing with
  // "already up to date" would be describing the wrong thing as up to date.
  if (!rebuildOnly && status.behind === 0 && !status.pendingBuild) return { reason: "already up to date", conflict: null };
  return { reason: null, conflict: null };
}

/** Files whose unattended replacement can strand the host: the updater itself, its
 *  lifecycle wrapper, and the unit/restart logic. A human must apply these. */
export const UPDATER_PATHS = [
  "lib/host/self-update.ts",
  "lib/host/update-decision.ts",
  "lib/host/self-update-channel.ts",
  "lib/host/self-update-timer.ts",
  "scripts/mso-service-update",
  "scripts/self-update.sh",
  "scripts/self-update-auto.ts",
  "scripts/mso-auto-update",
];

export function touchesUpdater(paths: readonly string[]): string | null {
  const hit = paths.map((p) => p.trim()).find((p) => p && UPDATER_PATHS.includes(p));
  return hit ?? null;
}

export interface AutoGateFacts {
  /** The owner opted in. A timer that survived a `false` pref must still refuse. */
  auto: boolean;
  /** `UpdateStatus.supported` for the resolved channel. */
  supported: boolean;
  reason: string | null;
  dirty: boolean;
  running: boolean;
  ahead: number;
  behind: number;
  pendingBuild: boolean;
  /** Consecutive failed unattended builds, read from the updater-written state. */
  consecutiveFailures: number;
  /** Paths in `HEAD..target`. Only read when there is something to apply. */
  changedPaths: readonly string[];
  target: string;
  /** Stable channel had no release tag and is tracking rolling main. */
  targetFallback: boolean;
}

export type AutoGate = { run: true } | { run: false; reason: string };

/**
 * Unattended-run gate. Stricter than `blockingReason`: it also refuses after two
 * consecutive failed builds and whenever the incoming commits touch the updater.
 * Every refusal is a sentence, because nobody is watching when it happens.
 */
export function autoUpdateGate(facts: AutoGateFacts): AutoGate {
  if (!facts.auto) return { run: false, reason: "automatic updates are turned off" };
  if (!facts.supported) return { run: false, reason: facts.reason ?? "this deployment cannot update itself" };
  if (facts.running) return { run: false, reason: "an update is already running" };
  if (facts.dirty) {
    return { run: false, reason: "the checkout has uncommitted changes; a fast-forward would refuse anyway" };
  }
  if (facts.consecutiveFailures >= 2) {
    return {
      run: false,
      reason: "paused after 2 consecutive failed builds — inspect the update log, then run mso update from a terminal",
    };
  }
  if (facts.ahead > 0) {
    return {
      run: false,
      reason: facts.behind > 0
        ? `local main has diverged from ${facts.target} (ahead ${facts.ahead}, behind ${facts.behind}); reconcile first`
        : `local main is ahead of ${facts.target} by ${facts.ahead} commit(s); push or reconcile first`,
    };
  }
  if (facts.behind === 0 && !facts.pendingBuild) {
    return {
      run: false,
      reason: facts.targetFallback
        ? `no release tag exists yet, so ${facts.target} is the target; already up to date`
        : `already up to date with ${facts.target}`,
    };
  }
  if (facts.behind > 0) {
    const hit = touchesUpdater(facts.changedPaths);
    if (hit) {
      return {
        run: false,
        reason: `the incoming commits change ${hit}, part of the updater; apply this one manually with mso update`,
      };
    }
  }
  return { run: true };
}
