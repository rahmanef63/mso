import "server-only";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { HostError } from "./host-error";

// SERVER-ONLY. "Is there a newer MSO, and pull it in" — the deploy that CLAUDE.md
// describes (`git pull` → build → restart), driven from Settings instead of from a
// terminal the owner may not have open.
//
// Prod is systemd with NO webhook, so a commit on main changes nothing anyone can
// see until someone rebuilds. That someone was always a person with ssh. This makes
// it a button.
//
// THE UPDATE DOES NOT RUN IN THIS PROCESS, and that is not a style choice: the last
// step replaces the process serving MSO, and systemd's default KillMode kills every
// child in mso.service's cgroup. A detached child is still in that cgroup, so it
// would die mid-`next build`, with `.next` already deleted and nothing to restart
// into. The job is therefore handed to the OWNER'S transient user unit via
// `systemd-run --user`. That gives it a separate cgroup without granting the web app
// passwordless root. At the end the updater signals mso.service's same-UID MainPID;
// Restart=always brings the system unit back on the freshly-built checkout.
const UNIT = "mso-self-update";
const LOG_TAIL = 12_000;
const GIT_TIMEOUT_MS = 20_000;
const FETCH_TIMEOUT_MS = 45_000;
/** Enough to see what is coming without turning the panel into a git log. */
const MAX_COMMITS = 25;

export interface UpdateCommit {
  sha: string;
  subject: string;
  date: string;
}

export interface UpdateStatus {
  /** False when this deployment cannot self-update (not a checkout, no systemd). */
  supported: boolean;
  /** Why not, when `supported` is false — shown to the operator verbatim. */
  reason: string | null;
  /** HEAD of the CHECKOUT — what a rebuild would compile. */
  current: string;
  currentSubject: string;
  /** The commit the RUNNING build was compiled from (baked in by next.config), or
   *  "" when the build carried no .git. Differs from `current` whenever someone
   *  pulled without rebuilding — the state the panel calls "a build is pending". */
  buildSha: string;
  pendingBuild: boolean;
  behind: number;
  commits: UpdateCommit[];
  /** Uncommitted work in the checkout: a `--ff-only` merge would fail, so refuse early. */
  dirty: boolean;
  running: boolean;
  /** False when `git fetch` could not reach the remote — `behind` is then only local knowledge. */
  remoteChecked: boolean;
  log: string;
}

export const updateLogPath = (): string => {
  const override = process.env.MSO_UPDATE_LOG?.trim();
  return override || path.join(os.homedir(), ".mso", "self-update.log");
};

const repoRoot = (): string => process.cwd();

/** Arguments are pure/testable because this boundary is security-sensitive: the
 * request may choose only update vs rebuild. No path, command, ref, or root-capable
 * argument comes from the client. */
export function updateUnitArgs(root: string, logPath: string, rebuildOnly = false): string[] {
  return [
    "--user",
    "--collect",
    `--unit=${UNIT}`,
    `--property=WorkingDirectory=${root}`,
    // A build on a small VPS is minutes, not seconds; the default 90s start
    // timeout would kill it exactly at the point of no return.
    "--property=TimeoutStartSec=3600",
    `--setenv=MSO_UPDATE_LOG=${logPath}`,
    "/bin/bash",
    path.join(root, "scripts", "mso-service-update"),
    ...(rebuildOnly ? ["--rebuild-only"] : []),
  ];
}

interface Ran {
  code: number;
  stdout: string;
  stderr: string;
}

function run(command: string, args: readonly string[], timeout = GIT_TIMEOUT_MS): Promise<Ran> {
  return new Promise((resolve) => {
    execFile(
      command,
      [...args],
      { cwd: repoRoot(), timeout, maxBuffer: 1024 * 1024, windowsHide: true, shell: false },
      (error, stdout, stderr) => {
        const code = typeof (error as { code?: number } | null)?.code === "number" ? (error as { code: number }).code : error ? 1 : 0;
        resolve({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
      },
    );
  });
}

const git = (args: readonly string[], timeout?: number) => run("git", args, timeout);

/** `<sha>\x1f<subject>\x1f<iso date>` per line — a separator no subject can contain. */
export function parseCommits(stdout: string): UpdateCommit[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, MAX_COMMITS)
    .map((line) => {
      const [sha = "", subject = "", date = ""] = line.split("\x1f");
      return { sha, subject: subject.slice(0, 200), date: date.slice(0, 10) };
    })
    .filter((c) => c.sha);
}

/**
 * Why this update must not start, or `null` when it may.
 *
 * Pure, and separate from the doing, because every one of these is a refusal an
 * operator has to be able to read — "nothing happened and here is why" beats a
 * build that fails halfway through with the live `.next` already deleted.
 */
export function blockingReason(status: UpdateStatus, rebuildOnly: boolean): string | null {
  if (!status.supported) return status.reason ?? "this deployment cannot update itself";
  if (status.running) return "an update is already running";
  if (status.dirty) {
    return "the checkout has uncommitted changes — commit or stash them on the host first, a fast-forward would refuse anyway";
  }
  // `pendingBuild` is a reason to run even with nothing to pull: the checkout
  // already holds code the running process was not built from, and refusing with
  // "already up to date" would be describing the wrong thing as up to date.
  if (!rebuildOnly && status.behind === 0 && !status.pendingBuild) return "already up to date";
  return null;
}

async function isRunning(): Promise<boolean> {
  // `is-active` on a transient unit that has been collected exits non-zero, which
  // is the same answer as "never ran" — both mean "not running", so the code is
  // all we need here. Check the old system-unit location too while installations
  // migrate from the pre-0.2.1 sudo-based updater.
  const [userUnit, legacySystemUnit] = await Promise.all([
    run("systemctl", ["--user", "is-active", `${UNIT}.service`], 10_000),
    run("systemctl", ["is-active", `${UNIT}.service`], 10_000),
  ]);
  return userUnit.code === 0 || legacySystemUnit.code === 0;
}

async function readLog(): Promise<string> {
  const raw = await fs.readFile(updateLogPath(), "utf8").catch(() => "");
  return raw.length > LOG_TAIL ? raw.slice(-LOG_TAIL) : raw;
}

/**
 * @param fetchRemote when true, ask the remote first. A check costs a network
 *   round trip, so the panel asks for one and the poller during an update does not.
 */
export async function getUpdateStatus(fetchRemote = true): Promise<UpdateStatus> {
  const buildSha = (process.env.NEXT_PUBLIC_COMMIT_SHA ?? "").trim();
  // Read ONCE: the panel polls this every 3s while a build runs, and the log is
  // the biggest thing in the response.
  const log = await readLog();
  const base: UpdateStatus = {
    supported: false,
    reason: null,
    current: "unknown",
    currentSubject: "",
    buildSha,
    pendingBuild: false,
    behind: 0,
    commits: [],
    dirty: false,
    running: false,
    remoteChecked: false,
    log,
  };

  const inside = await git(["rev-parse", "--is-inside-work-tree"]);
  if (inside.code !== 0 || inside.stdout.trim() !== "true") {
    return { ...base, reason: "this deployment is not a git checkout, so there is nothing to pull" };
  }

  // The installer enables linger and gives mso.service XDG_RUNTIME_DIR precisely
  // so the service can reach this per-user manager. Unlike the old sudo path, this
  // is both non-interactive and non-root.
  const userManager = await run("systemctl", ["--user", "show-environment"], 10_000);
  if (userManager.code !== 0) {
    return {
      ...base,
      reason:
        "the per-user systemd manager is unavailable — re-run scripts/install.sh once to restore linger and the user bus",
    };
  }

  const [loadState, serviceUser, restartPolicy] = await Promise.all([
    run("systemctl", ["show", "-p", "LoadState", "--value", "mso.service"], 10_000),
    run("systemctl", ["show", "-p", "User", "--value", "mso.service"], 10_000),
    run("systemctl", ["show", "-p", "Restart", "--value", "mso.service"], 10_000),
  ]);
  if (loadState.code !== 0 || loadState.stdout.trim() !== "loaded") {
    return { ...base, reason: "mso.service is not installed as a systemd service, so it cannot safely restart itself" };
  }
  if (restartPolicy.code !== 0 || restartPolicy.stdout.trim() === "no") {
    return {
      ...base,
      reason: "mso.service has no automatic restart policy; refusing to stop the running process during self-update",
    };
  }
  const owner = os.userInfo().username;
  if (serviceUser.code !== 0 || serviceUser.stdout.trim() !== owner) {
    return {
      ...base,
      reason: `mso.service runs as ${serviceUser.stdout.trim() || "an unknown user"}, not ${owner}; refusing a cross-user update`,
    };
  }

  const running = await isRunning();
  const [head, subject, status] = await Promise.all([
    git(["rev-parse", "--short", "HEAD"]),
    git(["log", "-1", "--format=%s"]),
    git(["status", "--porcelain"]),
  ]);

  let remoteChecked = false;
  if (fetchRemote && !running) {
    // Quiet + a hard timeout: an unreachable remote must degrade to "could not
    // check", never hang the Settings panel that is waiting on this.
    const fetched = await git(["fetch", "--quiet", "origin", "main"], FETCH_TIMEOUT_MS);
    remoteChecked = fetched.code === 0;
  }

  const [count, commitLog] = await Promise.all([
    git(["rev-list", "--count", "HEAD..origin/main"]),
    git(["log", "--format=%h%x1f%s%x1f%cs", `-${MAX_COMMITS}`, "HEAD..origin/main"]),
  ]);

  const current = head.stdout.trim() || "unknown";
  return {
    ...base,
    supported: true,
    current,
    currentSubject: subject.stdout.trim(),
    // Only when we know both: a build with no sha baked in (an archive export, a
    // dev server) must not be reported as permanently stale.
    pendingBuild: Boolean(buildSha) && current !== "unknown" && buildSha !== current,
    behind: count.code === 0 ? Number(count.stdout.trim()) || 0 : 0,
    commits: commitLog.code === 0 ? parseCommits(commitLog.stdout) : [],
    dirty: status.stdout.trim().length > 0,
    running,
    remoteChecked,
    log,
  };
}

/**
 * Hand the update to a transient systemd unit and return immediately.
 *
 * Nothing from the request reaches a shell: the only knob is a boolean, and the
 * ref is hard-coded to `origin/main`.
 */
export async function startUpdate(rebuildOnly = false): Promise<UpdateStatus> {
  const status = await getUpdateStatus(true);
  const blocked = blockingReason(status, rebuildOnly);
  if (blocked) throw new HostError(blocked);

  const script = path.join(repoRoot(), "scripts", "mso-service-update");
  if (!(await fs.stat(script).catch(() => null))) throw new HostError(`missing ${script}`);

  const started = await run(
    "systemd-run",
    updateUnitArgs(repoRoot(), updateLogPath(), rebuildOnly),
    30_000,
  );
  if (started.code !== 0) {
    throw new HostError(
      `could not start the updater: ${(started.stderr || started.stdout).trim().slice(0, 300) || `exit ${started.code}`}. Re-run scripts/install.sh once if the user systemd manager is unavailable`,
    );
  }
  return { ...status, running: true };
}
