import "server-only";
import path from "node:path";
import { errorMessage as message } from "@/lib/host/error-message";
import {
  APPDECK_DRIVERS,
  assertPinnedUpdateOptions,
  pinnedInstallerUninstallArgv,
  pinnedInstallerUpdateArgv,
  quiesceAndSnapshot,
  quiesceManagedApp,
  recoverManagedApp,
  type QuiesceState,
} from "./appdeck-lifecycle";
import { isManagedAppBackupId } from "./backups";
import { getManagedAppDefinition } from "./catalog";
import { startManagedAppJob } from "./jobs";
import { activeOperation } from "./lock";
import { restoreManagedAppBackup } from "./restore";
import { resolveCommand, runProgram } from "./runner";
import type { ManagedAppId, ManagedAppJob } from "./types";
import { assertChannel, updateAdapter, UNINSTALL_PREVIEW_FLAG } from "./update-cli";
import type { ManagedAppUpdateOptions, ManagedAppUpdateStatus } from "./update-types";

const UPDATE_TIMEOUT_MS = 3_600_000;
const UNINSTALL_TIMEOUT_MS = 900_000;
const CHECK_CACHE_MS = 60_000;

const cache = new Map<ManagedAppId, ManagedAppUpdateStatus>();

/** AppDeck exposes reviewed, digest-pinned updates for every managed app while
 *  keeping mutable upstream channels and dry-run/channel switches fail-closed. */
function safeCapabilities(id: ManagedAppId, capabilities = updateAdapter(id).capabilities) {
  if (APPDECK_DRIVERS[id].updateMode === "adapter") return capabilities;
  return { ...capabilities, apply: true, dryRun: false, channel: false };
}

async function resolveProgram(command: string): Promise<string> {
  const resolved = await resolveCommand(command);
  if (!resolved || !path.isAbsolute(resolved)) throw new Error(`${command} is not installed`);
  return resolved;
}

function unavailable(id: ManagedAppId, error: string): ManagedAppUpdateStatus {
  const { capabilities } = updateAdapter(id);
  const canFallbackUninstall = APPDECK_DRIVERS[id].fallbackUninstall;
  return {
    applicationId: id,
    currentVersion: null,
    latestVersion: null,
    updateAvailable: null,
    detail: null,
    channel: { value: null, kind: null, available: [], switchable: false, reason: null },
    installKind: null,
    capabilities: {
      ...safeCapabilities(id, capabilities),
      check: false,
      apply: false,
      dryRun: false,
      channel: false,
      uninstall: canFallbackUninstall ? false : false,
      rollback: capabilities.rollback ? true : false,
    },
    checkedAt: new Date().toISOString(),
    error,
  };
}

export function cachedUpdateStatus(id: ManagedAppId): ManagedAppUpdateStatus {
  const cached = cache.get(id);
  if (cached) return cached;
  return {
    applicationId: id, currentVersion: null, latestVersion: null, updateAvailable: null, detail: null,
    channel: { value: null, kind: null, available: [], switchable: false, reason: null },
    installKind: null, capabilities: safeCapabilities(id), checkedAt: null, error: null,
  };
}

export async function checkUpdate(id: ManagedAppId, force = false): Promise<ManagedAppUpdateStatus> {
  const cached = cache.get(id);
  if (cached && !force && Date.now() - Date.parse(cached.checkedAt ?? "") < CHECK_CACHE_MS) return cached;
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

/** Update via AppDeck: auto-quiesce -> backup -> digest-pinned apply -> auto-recover on failure. */
export async function startUpdate(id: ManagedAppId, options: ManagedAppUpdateOptions = {}): Promise<ManagedAppJob> {
  const definition = getManagedAppDefinition(id);
  const driver = APPDECK_DRIVERS[id];
  let argv: string[];
  if (driver.updateMode === "pinned-installer") {
    assertPinnedUpdateOptions(id, options);
    argv = pinnedInstallerUpdateArgv(id);
  } else {
    argv = updateAdapter(id).updateArgv(await resolveProgram(definition.command), options);
  }
  const quiesce: QuiesceState = { wasRunning: false };
  return startManagedAppJob({
    applicationId: id,
    kind: "update",
    argv,
    timeoutMs: UPDATE_TIMEOUT_MS,
    prepare: options.dryRun ? undefined : (append) => quiesceAndSnapshot(definition, "pre-update", append, quiesce).then(() => undefined),
    onFailure: options.dryRun ? undefined : (append) => recoverManagedApp(definition, quiesce.wasRunning, append, "failure"),
  });
}

/** Mutable upstream channel switching stays disabled until immutable channel digests exist. */
export async function setChannel(id: ManagedAppId, channel: string): Promise<ManagedAppJob> {
  const adapter = updateAdapter(id);
  if (!adapter.capabilities.channel) throw new Error(`channel switching is not supported for ${id}`);
  assertChannel(channel);
  throw new Error(`${id} mutable channel switching is disabled until a reviewed immutable artifact target and digest are committed`);
}

async function assertPreviewSupported(program: string, id: ManagedAppId, helpArgs: string[] = ["uninstall", "--help"]): Promise<void> {
  const help = await runProgram(program, helpArgs, 10_000);
  if (!`${help.stdout}${help.stderr}`.includes(UNINSTALL_PREVIEW_FLAG)) {
    throw new Error(`the installed ${id} CLI does not advertise \`uninstall ${UNINSTALL_PREVIEW_FLAG}\`, so previewing a removal is not supported`);
  }
}

/** Uninstall via AppDeck: exact confirmation -> auto-quiesce -> pre-uninstall backup -> remove. */
export async function startUninstall(id: ManagedAppId, confirmation: unknown, dryRun = false): Promise<ManagedAppJob> {
  if (confirmation !== id) throw new Error("uninstall confirmation does not match the application id");
  const definition = getManagedAppDefinition(id);
  const driver = APPDECK_DRIVERS[id];
  let argv: string[];
  try {
    const program = await resolveProgram(definition.command);
    if (dryRun) await assertPreviewSupported(program, id);
    argv = updateAdapter(id).uninstallArgv(program, dryRun);
  } catch (error) {
    if (!driver.fallbackUninstall || !message(error).includes("not installed")) throw error;
    argv = pinnedInstallerUninstallArgv(id, dryRun);
    if (dryRun) await assertPreviewSupported(argv[0]!, id, [id, "uninstall", "--help"]);
  }
  const quiesce: QuiesceState = { wasRunning: false };
  return startManagedAppJob({
    applicationId: id,
    kind: "uninstall",
    argv,
    timeoutMs: UNINSTALL_TIMEOUT_MS,
    prepare: dryRun ? undefined : (append) => quiesceAndSnapshot(definition, "pre-uninstall", append, quiesce).then(() => undefined),
    onFailure: dryRun ? undefined : (append) => recoverManagedApp(definition, quiesce.wasRunning, append, "failure"),
  });
}

/** Rollback via AppDeck: auto-quiesce -> safety backup + restore -> resume if previously running. */
export async function startRollback(id: ManagedAppId, backupId: string, pin?: string): Promise<ManagedAppJob> {
  if (!isManagedAppBackupId(backupId)) throw new Error("unknown backup");
  const adapter = updateAdapter(id);
  if (!adapter.capabilities.rollback) throw new Error(`rollback is not supported for ${id}`);
  if (pin && !adapter.pin) throw new Error(`pinning a version during a rollback is not supported for ${id}: its pin switches the git checkout, which would stash the restored files`);
  if (pin) throw new Error(`pinning during rollback is disabled until ${id} has a reviewed immutable artifact target and digest`);
  const definition = getManagedAppDefinition(id);
  const quiesce: QuiesceState = { wasRunning: false };
  return startManagedAppJob({
    applicationId: id,
    kind: "restore",
    argv: [],
    timeoutMs: UPDATE_TIMEOUT_MS,
    prepare: async (append) => {
      quiesce.wasRunning = await quiesceManagedApp(definition, append);
      await restoreManagedAppBackup(id, backupId, append);
    },
    onSuccess: (append) => recoverManagedApp(definition, quiesce.wasRunning, append, "restore"),
    onFailure: (append) => recoverManagedApp(definition, quiesce.wasRunning, append, "failure"),
  });
}
