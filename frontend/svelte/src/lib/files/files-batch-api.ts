import { ApiError } from "../host-api.ts";
import { deleteFsEntry } from "./files-api.ts";
import { copyFsEntry, moveFsEntry, validateFsPath } from "./files-ops-api.ts";
import { joinFsPath, validateEntryName } from "./files-path-utils.ts";
import { detectShellBridge, resolveApiUrl, type ShellBridge } from "../shell-bridge.ts";

export async function renameFsEntry(
  dir: string,
  fromName: string,
  toName: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  bridge: ShellBridge = detectShellBridge(),
): Promise<string> {
  const fromErr = validateEntryName(fromName, "Source entry");
  if (fromErr) throw new ApiError(fromErr, 400);
  const toErr = validateEntryName(toName, "New name");
  if (toErr) throw new ApiError(toErr, 400);
  const cleanFrom = fromName.trim();
  const cleanTo = toName.trim();
  if (cleanFrom === cleanTo) throw new ApiError("New name must differ from the current name.", 400);
  await moveFsEntry(joinFsPath(dir, cleanFrom), joinFsPath(dir, cleanTo), signal, fetcher, bridge);
  return cleanTo;
}

export async function batchDeleteFsEntries(
  dir: string,
  names: readonly string[],
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  bridge: ShellBridge = detectShellBridge(),
): Promise<{ deleted: string[]; failed: string[] }> {
  const deleted: string[] = [];
  const failed: string[] = [];
  for (const name of names) {
    if (signal.aborted) break;
    try {
      await deleteFsEntry(joinFsPath(dir, name), signal, fetcher, bridge);
      deleted.push(name);
    } catch {
      failed.push(name);
    }
  }
  return { deleted, failed };
}

export async function batchTransferFsEntries(
  mode: "copy" | "move",
  fromDir: string,
  names: readonly string[],
  destDir: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  bridge: ShellBridge = detectShellBridge(),
): Promise<{ transferred: string[]; failed: string[] }> {
  const cleanDest = validateFsPath(destDir, "Destination folder");
  const transferred: string[] = [];
  const failed: string[] = [];
  const fn = mode === "copy" ? copyFsEntry : moveFsEntry;
  for (const name of names) {
    if (signal.aborted) break;
    try {
      await fn(joinFsPath(fromDir, name), joinFsPath(cleanDest, name), signal, fetcher, bridge);
      transferred.push(name);
    } catch {
      failed.push(name);
    }
  }
  return { transferred, failed };
}
