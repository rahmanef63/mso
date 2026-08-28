import "server-only";
import type { ManagedAppId } from "./types";
import { probe9Router, probeHermes, probeOpenclaw, type ProbeResult } from "./update-probe";
import { MANAGED_APP_UPDATE_CHANNELS } from "./update-types";
import type { ManagedAppUpdateCapabilities, ManagedAppUpdateOptions } from "./update-types";

// The two adapters: the argv each CLI wants, and what MSO is willing to drive.
// Every flag below was taken from `--help` and the installed source on this
// host, never guessed — where one looks odd there is a comment naming the file
// that proved it.
//
// NOTHING here interpolates a value into a command. Every user-supplied
// channel/tag/branch passes an allowlist or a strict pattern FIRST and then
// becomes its own argv element next to its flag, so the job layer's
// control-character tripwire should never be the thing that catches a bad one.

/** A dist-tag we are willing to name, or an exact version. Deliberately NOT the
 *  full `--tag` grammar: upstream also accepts `github:owner/repo#ref`, which
 *  would turn one API call into "install arbitrary third-party code as this
 *  user". Pinning to a released version is the rollback story; installing from
 *  a stranger's fork is not. */
const TAG_ALLOWED = new Set(["latest", "stable", "extended-stable", "beta", "dev"]);
const VERSION_RE = /^\d+(\.\d+){1,3}(-[A-Za-z0-9][A-Za-z0-9.]*)?$/;
/** git's ref rules, narrowed: no `..`, no `//`, no leading dash, no `.lock`. */
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;

export function assertChannel(value: string): string {
  if (!(MANAGED_APP_UPDATE_CHANNELS as readonly string[]).includes(value)) throw new Error("unsupported update channel");
  return value;
}

export function assertTag(value: string): string {
  if (!TAG_ALLOWED.has(value) && !VERSION_RE.test(value)) throw new Error("unsupported update tag");
  return value;
}

export function assertBranch(value: string): string {
  if (!BRANCH_RE.test(value) || value.includes("..") || value.includes("//") || value.endsWith(".lock")) {
    throw new Error("unsupported update branch");
  }
  return value;
}

/** The one flag that makes a preview a preview. Exported because update.ts
 *  checks the INSTALLED CLI still advertises it before running one: both
 *  uninstalls demand a confirmation flag even to preview (proof at each
 *  `uninstallArgv` below), so whether this flag is still honoured is the only
 *  thing between "Preview removal" and a real, unbacked-up removal. */
export const UNINSTALL_PREVIEW_FLAG = "--dry-run";

export interface UpdateAdapter {
  capabilities: ManagedAppUpdateCapabilities;
  /** Where a rollback pin goes for this app: OpenClaw pins a package version.
   *  `null` = this app CANNOT be pinned as part of a rollback (Hermes — see
   *  there). Same validation as the update options. */
  pin: ((value: string) => string[]) | null;
  updateArgv: (program: string, options: ManagedAppUpdateOptions) => string[];
  uninstallArgv: (program: string, dryRun: boolean) => string[];
  probe: (program: string) => Promise<ProbeResult>;
}

function reject(option: string, app: string): never {
  throw new Error(`${option} is not supported for ${app}`);
}

const ADAPTERS: Record<ManagedAppId, UpdateAdapter> = {
  hermes: {
    capabilities: {
      check: true,
      apply: true,
      // `hermes update` has no --dry-run; `update --check` IS its preview.
      dryRun: false,
      channel: false,
      rollback: true,
      uninstall: true,
      installCommand: "bash scripts/managed-app-install hermes install",
      uninstallCommand: null,
    },
    // NO rollback pin. Hermes' only pin is `--branch`, and a rollback restores
    // ~/.hermes — which IS the git checkout, minus the `.git` the backup prunes.
    // So a restore always leaves the working tree dirty against an unchanged
    // HEAD, and `hermes update` then runs `_stash_local_changes_if_needed`
    // (hermes_cli/main.py:7053) on exactly the files it just wrote back. With
    // our mandatory `--yes` that is a NON-interactive update, which consults
    // `updates.non_interactive_local_changes` (main.py:10757): the default
    // re-applies the stash, `discard` DROPS it, and a conflicting apply ends in
    // `git reset --hard HEAD` with the files left in a stash nobody mentions —
    // while the job still reports success. Undoing the restore is the one thing
    // a rollback must never do, so the option does not exist.
    pin: null,
    updateArgv: (program, options) => {
      if (options.dryRun) reject("dry run", "hermes");
      if (options.channel) reject("channel switching", "hermes");
      if (options.tag) reject("tag pinning", "hermes");
      if (options.noRestart) reject("--no-restart", "hermes");
      // Neither --backup nor --no-backup: the app's own `updates.pre_update_backup`
      // is the operator's setting and overriding it in either direction would be
      // MSO deciding something it does not own. Ours runs first regardless, and
      // ours is the one that cannot restore a git checkout (§ restore.ts).
      return [program, "update", "--yes", ...(options.branch ? ["--branch", assertBranch(options.branch)] : [])];
    },
    // hermes_cli/uninstall.py `run_uninstall`: --yes takes the non-interactive
    // path with no tty gate. WITHOUT --full it removes the code and keeps
    // ~/.hermes (config + data) — the conservative half, and the only half MSO
    // will run. `--full` is not exposed anywhere in this subsystem.
    //
    // --yes rides along with --dry-run because a PREVIEW cannot run without it:
    // `cmd_uninstall` calls `_require_tty("uninstall")` before it ever reaches
    // `run_uninstall` unless --yes was passed (main.py:4670 → :480), and jobs
    // spawn with stdin closed, so a preview without it is exit 1 and no output.
    // What makes the pair safe is the ORDER inside run_uninstall: the --dry-run
    // branch prints and returns BEFORE the --yes fast path (uninstall.py:576).
    // That is upstream's call, not ours, which is why update.ts re-checks that
    // the installed CLI still advertises the flag before previewing.
    uninstallArgv: (program, dryRun) => [program, "uninstall", "--yes", ...(dryRun ? [UNINSTALL_PREVIEW_FLAG] : [])],
    probe: probeHermes,
  },
  openclaw: {
    capabilities: {
      check: true,
      apply: true,
      dryRun: true,
      channel: true,
      rollback: true,
      uninstall: true,
      installCommand: "bash scripts/managed-app-install openclaw install",
      uninstallCommand: null,
    },
    pin: (value) => ["--tag", assertTag(value)],
    updateArgv: (program, options) => {
      if (options.branch) reject("branch switching", "openclaw");
      return [
        program,
        "update",
        "--yes",
        // --json ONLY for a dry run. In a real run it silences the progress
        // stream (dist/update-cli-CnCrJkiC.js: `info: (msg) => { if
        // (!params.opts.json) defaultRuntime.log(msg); }`), which would leave
        // the operator watching an empty transcript for twenty minutes and
        // then one blob. A dry run is consumed as data, so there it earns its
        // place — and that JSON is the only machine-readable preview either
        // app offers.
        ...(options.dryRun ? ["--dry-run", "--json"] : []),
        ...(options.channel ? ["--channel", assertChannel(options.channel)] : []),
        ...(options.tag ? ["--tag", assertTag(options.tag)] : []),
        // Restart is the DEFAULT and stays it: a package update that restarts
        // verifies the restarted service reports the expected version before it
        // succeeds (docs/cli/update.md). Skipping it leaves new bytes on disk
        // with the old process still serving — the one outcome nothing notices
        // until some unrelated reboot silently swaps the version.
        ...(options.noRestart ? ["--no-restart"] : []),
      ];
    },
    // dist/uninstall-CU8IZGSh.js: `--non-interactive` without --yes exits 1,
    // and with no scope flag it exits 1 too ("requires explicit scopes") —
    // interactively it would open a multiselect. `--service --state` is the
    // command's own headline scope ("gateway service + local data"); the
    // operator's workspace dirs (--workspace) and --all are not offered here.
    //
    // --yes is here for a preview too, and there is no form that omits it: the
    // `!interactive && !opts.yes` guard runs BEFORE `dryRun` is even read
    // (:82-86 vs :143), and its own --help says so — "--non-interactive Disable
    // prompts (requires --yes)". Dropping --non-interactive instead only trades
    // it for `confirm()` on a closed stdin. So the preview's safety rests on
    // --dry-run alone; update.ts verifies the CLI still declares it.
    uninstallArgv: (program, dryRun) => [program, "uninstall", "--non-interactive", "--yes", "--service", "--state", ...(dryRun ? [UNINSTALL_PREVIEW_FLAG] : [])],
    probe: probeOpenclaw,
  },
  "9router": {
    capabilities: {
      check: true,
      apply: true,
      // The wrapper's update is pull + recreate; a rehearsal of a docker pull
      // predicts nothing useful, so there is no dry run.
      dryRun: false,
      channel: false,
      rollback: true,
      uninstall: true,
      installCommand: "bash scripts/managed-app-9router install",
      uninstallCommand: null,
    },
    // The image is already pinned by reviewed digest. Rollback restores the
    // ~/.9router data snapshot and keeps that digest in place.
    pin: null,
    updateArgv: (program, options) => {
      if (options.dryRun) reject("dry run", "9router");
      if (options.channel) reject("channel switching", "9router");
      if (options.tag) reject("tag pinning", "9router");
      if (options.branch) reject("branch switching", "9router");
      if (options.noRestart) reject("--no-restart", "9router");
      return [program, "update", "--yes"];
    },
    uninstallArgv: (program, dryRun) => [program, "uninstall", "--yes", ...(dryRun ? [UNINSTALL_PREVIEW_FLAG] : [])],
    probe: probe9Router,
  },
};

export function updateAdapter(id: ManagedAppId): UpdateAdapter {
  return ADAPTERS[id];
}
