import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createBackup, isManagedAppBackupId, stateDirFor } from "./backups";
import { getManagedAppDefinition } from "./catalog";
import { startManagedAppJob } from "./jobs";
import { activeOperation } from "./lock";
import { assertManagedAppStopped } from "./manager";
import { restoreManagedAppBackup } from "./restore";
import { resolveCommand, runProgram } from "./runner";
import type { ManagedAppDefinition, ManagedAppId, ManagedAppJob } from "./types";
import { assertChannel, updateAdapter, UNINSTALL_PREVIEW_FLAG } from "./update-cli";
import type { ManagedAppBackup, ManagedAppUpdateOptions, ManagedAppUpdateStatus } from "./update-types";

// Validate, snapshot inside the operation, then submit guarded fixed argv.

/** OpenClaw's own per-STEP timeout is 1800 s and a run has several steps, so a
 *  30-minute wall clock would kill a healthy update mid-step. An hour is the
 *  job layer's ceiling; upstream's own step timeout fires long before it. */
const UPDATE_TIMEOUT_MS = 3_600_000;
const UNINSTALL_TIMEOUT_MS = 900_000;
/** A check spawns the app's CLI and, for Hermes, git-fetches twice. Cheap to
 *  cache, expensive to poll. */
const CHECK_CACHE_MS = 60_000;

const cache = new Map<ManagedAppId, ManagedAppUpdateStatus>();

function safeCapabilities(id: ManagedAppId, capabilities = updateAdapter(id).capabilities) {
  if (id === "9router") return capabilities;
  // Hermes/OpenClaw upstream update commands fetch mutable branch/channel/tag
  // content and execute it before MSO can verify repository-owned bytes. Until
  // a reviewed release artifact + digest is committed, discovery stays enabled
  // but apply/channel/dry-run update execution fails closed.
  return { ...capabilities, apply: false, dryRun: false, channel: false };
}

function assertVerifiedUpdatePath(id: ManagedAppId): void {
  if (id !== "9router") {
    throw new Error(`${id} automated update is disabled until a reviewed immutable artifact target and digest are committed`);
  }
}

/** Resolve the exact CLI or fail before creating a job. */
async function resolveProgram(command: string): Promise<string> {
  // Share detection's fallback for user-local CLIs outside systemd PATH.
  const resolved = await resolveCommand(command);
  if (!resolved || !path.isAbsolute(resolved)) throw new Error(`${command} is not installed`);
  return resolved;
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function unavailable(id: ManagedAppId, error: string): ManagedAppUpdateStatus {
  const { capabilities } = updateAdapter(id);
  return {
    applicationId: id,
    currentVersion: null,
    latestVersion: null,
    updateAvailable: null,
    detail: null,
    channel: { value: null, kind: null, available: [], switchable: false, reason: null },
    installKind: null,
    // File-based rollback survives a missing CLI; execution controls do not.
    capabilities: { ...safeCapabilities(id, capabilities), check: false, apply: false, dryRun: false, channel: false, uninstall: false, rollback: true },
    checkedAt: new Date().toISOString(),
    error,
  };
}

/** What a READ of the status serves: the last probe, or an empty shell when this
 *  server has not probed since it started. It never spawns anything — probing is
 *  a POST precisely because it runs the app's CLI and, for Hermes, git-fetches
 *  the operator's checkout twice. The shell still declares what the app
 *  supports, so the panel can render controls; only the FACTS are missing, and
 *  `checkedAt: null` is how it knows to ask for a probe. */
export function cachedUpdateStatus(id: ManagedAppId): ManagedAppUpdateStatus {
  const cached = cache.get(id);
  if (cached) return cached;
  return {
    applicationId: id, currentVersion: null, latestVersion: null, updateAvailable: null, detail: null,
    channel: { value: null, kind: null, available: [], switchable: false, reason: null },
    installKind: null, capabilities: safeCapabilities(id), checkedAt: null, error: null,
  };
}

/** Normalised update status for one app. Cached for a minute; `force` is what
 *  the explicit "Check for updates" button sends. */
export async function checkUpdate(id: ManagedAppId, force = false): Promise<ManagedAppUpdateStatus> {
  const cached = cache.get(id);
  // A cache entry always carries a stamp; `?? ""` parses to NaN, so an entry
  // that somehow does not is re-probed instead of being served forever.
  if (cached && !force && Date.now() - Date.parse(cached.checkedAt ?? "") < CHECK_CACHE_MS) return cached;
  // Probing runs the app's own CLI, and Hermes' check git-fetches the very
  // checkout a running update job is rebasing. Never race the job for it.
  const busy = activeOperation(id);
  if (busy) return cached ?? unavailable(id, `an operation is already running (${busy})`);
  const adapter = updateAdapter(id);
  let status: ManagedAppUpdateStatus;
  try {
    const probe = await adapter.probe(await resolveProgram(getManagedAppDefinition(id).command));
    status = { applicationId: id, ...probe, capabilities: safeCapabilities(id, adapter.capabilities), checkedAt: new Date().toISOString() };
  } catch (error) {
    status = unavailable(id, message(error));
  }
  cache.set(id, status);
  return status;
}

const exists = (target: string): Promise<boolean> =>
  fs.lstat(target).then(() => true, () => false);

/** The mandatory pre-flight snapshot. It runs inside the job, inside the lock,
 *  BEFORE anything spawns — and a throw here ends the job `failed` with nothing
 *  executed, which is the whole mechanism for "a failed backup aborts the
 *  update" (jobs.ts `prepare`). Null = there was nothing to snapshot. */
async function snapshot(definition: ManagedAppDefinition, reason: ManagedAppBackup["reason"], append: (text: string) => void): Promise<ManagedAppBackup | null> {
  const source = stateDirFor(definition);
  append(`[mso] ${reason} backup of ${source}\n`);
  // UNINSTALL only: a missing state dir left an app whose data was already
  // removed by hand permanently un-uninstallable — the job died here and the
  // uninstall never ran, with no way out through the UI. There is nothing left to
  // protect, so say so and continue. An UPDATE keeps failing closed: its state
  // dir is also the install (Hermes' is a git checkout), so its absence means
  // something is wrong that an update should not paper over.
  if (reason === "pre-uninstall" && !(await exists(source))) {
    append(`[mso] nothing to back up - ${source} does not exist\n`);
    return null;
  }
  let backup: ManagedAppBackup;
  try {
    backup = await createBackup(definition, reason, () => assertManagedAppStopped(definition.id));
  } catch (error) {
    throw new Error(`${reason} backup failed, nothing was run: ${message(error)}`);
  }
  const mb = backup.bytes === null ? "?" : (backup.bytes / 1024 / 1024).toFixed(1);
  append(`[mso] backup ${backup.id} - ${backup.files ?? "?"} files, ${mb} MB\n`);
  // Said out loud every time, because it is what makes this a STATE snapshot
  // rather than an install image: restoring it will not rebuild a git checkout
  // or a node_modules tree.
  append(`[mso] not in the backup (and not restorable from it): ${backup.skipped.dirNames.join(", ")}\n`);
  return backup;
}

/** Update, or preview one. `dryRun` skips the backup on purpose: a preview
 *  writes nothing, and copying 366 MB to predict a no-op is theatre. */
export async function startUpdate(id: ManagedAppId, options: ManagedAppUpdateOptions = {}): Promise<ManagedAppJob> {
  assertVerifiedUpdatePath(id);
  const definition = getManagedAppDefinition(id);
  const argv = updateAdapter(id).updateArgv(await resolveProgram(definition.command), options);
  return startManagedAppJob({
    applicationId: id,
    kind: "update",
    argv,
    timeoutMs: UPDATE_TIMEOUT_MS,
    prepare: options.dryRun ? undefined : (append) => snapshot(definition, "pre-update", append).then(() => undefined),
  });
}

/** A channel switch executes an update, so it needs the same immutable target. */
export async function setChannel(id: ManagedAppId, channel: string): Promise<ManagedAppJob> {
  const adapter = updateAdapter(id);
  if (!adapter.capabilities.channel) throw new Error(`channel switching is not supported for ${id}`);
  assertVerifiedUpdatePath(id);
  return startUpdate(id, { channel: assertChannel(channel) });
}

/** A preview is the ONE flow that skips the mandatory pre-flight backup, and
 *  both CLIs refuse a headless uninstall — preview included — unless a
 *  confirmation flag rides along (proof in update-cli.ts). So whether the
 *  installed CLI still honours `--dry-run` is all that stands between "Preview
 *  removal" and a real, unbacked-up removal. Ask it: `--help` costs ~0.3 s next
 *  to what it guards, and a refused preview costs nothing at all. */
async function assertPreviewSupported(program: string, id: ManagedAppId): Promise<void> {
  const help = await runProgram(program, ["uninstall", "--help"], 10_000);
  if (!`${help.stdout}${help.stderr}`.includes(UNINSTALL_PREVIEW_FLAG)) {
    throw new Error(`the installed ${id} CLI does not advertise \`uninstall ${UNINSTALL_PREVIEW_FLAG}\`, so previewing a removal is not supported`);
  }
}

/** Uninstall. `confirmation` must be the app id, typed by the operator — this
 *  is the second gate after the session, and the reason a stray POST cannot
 *  remove an app. */
export async function startUninstall(id: ManagedAppId, confirmation: unknown, dryRun = false): Promise<ManagedAppJob> {
  if (confirmation !== id) throw new Error("uninstall confirmation does not match the application id");
  const definition = getManagedAppDefinition(id);
  const program = await resolveProgram(definition.command);
  if (dryRun) await assertPreviewSupported(program, id);
  const argv = updateAdapter(id).uninstallArgv(program, dryRun);
  return startManagedAppJob({
    applicationId: id,
    kind: "uninstall",
    argv,
    timeoutMs: UNINSTALL_TIMEOUT_MS,
    prepare: dryRun ? undefined : (append) => snapshot(definition, "pre-uninstall", append).then(() => undefined),
  });
}

/** Rollback = restore a snapshot, then optionally pin the version that snapshot
 *  belongs with — OpenClaw's `--tag` only; Hermes has no pin that survives a
 *  restore (`UpdateAdapter.pin` is null there). Neither app has a rollback verb
 *  of its own. One job: the restore is `prepare`, the pin is the argv, so a
 *  restore that fails never runs the pin. */
export async function startRollback(id: ManagedAppId, backupId: string, pin?: string): Promise<ManagedAppJob> {
  if (!isManagedAppBackupId(backupId)) throw new Error("unknown backup");
  const adapter = updateAdapter(id);
  // Refused rather than silently dropped: for Hermes the pin IS a branch switch,
  // which auto-stashes the very files the restore just wrote back (update-cli.ts)
  // — a rollback that quietly undoes itself and still reports success.
  if (pin && !adapter.pin) throw new Error(`pinning a version during a rollback is not supported for ${id}: its pin switches the git checkout, which would stash the restored files`);
  if (pin) throw new Error(`pinning during rollback is disabled until ${id} has a reviewed immutable artifact target and digest`);
  const argv: string[] = [];
  return startManagedAppJob({
    applicationId: id,
    kind: "restore",
    argv,
    timeoutMs: UPDATE_TIMEOUT_MS,
    prepare: (append) => restoreManagedAppBackup(id, backupId, append).then(() => undefined),
  });
}
