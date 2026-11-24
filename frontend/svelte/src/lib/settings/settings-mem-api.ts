import { ApiError } from "../host-api.ts";
import { detectShellBridge } from "../shell-bridge.ts";
import type { ShellBridge } from "../shell-bridge.ts";
import { isRecord, requestJson } from "./settings-request.ts";

// ---------------------------------------------------------------------------
// Memory & Server Backup
// ---------------------------------------------------------------------------

export * from "./settings-mem-types.ts";
import type {
  MemoryBackupHistoryEntry, MemoryBackupScan, MemoryBackupSummary, MemoryBackupVerification, MemoryFact,
} from "./settings-mem-types.ts";

function parseBackupScan(raw: unknown): MemoryBackupScan {
  if (!isRecord(raw)) throw new ApiError("The memory backup scan response is invalid.", 502);
  return {
    files: typeof raw.files === "number" ? raw.files : 0,
    bytes: typeof raw.bytes === "number" ? raw.bytes : 0,
    missing: typeof raw.missing === "number" ? raw.missing : 0,
    rejected: typeof raw.rejected === "number" ? raw.rejected : 0,
    excluded: typeof raw.excluded === "number" ? raw.excluded : 0,
    truncated: Boolean(raw.truncated),
  };
}

function parseBackupSummary(raw: unknown): MemoryBackupSummary {
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.manifestSha256 !== "string") {
    throw new ApiError("The memory backup summary response is invalid.", 502);
  }
  return {
    id: raw.id,
    state: raw.state === "partial" ? "partial" : "snapshot",
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "",
    directory: typeof raw.directory === "string" ? raw.directory : "",
    manifestSha256: raw.manifestSha256,
    scan: parseBackupScan(raw.scan),
    compressedBytes: typeof raw.compressedBytes === "number" ? raw.compressedBytes : 0,
    sourceDiscoveryTruncated: Boolean(raw.sourceDiscoveryTruncated),
  };
}

export async function readMemories(
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  bridge: ShellBridge = detectShellBridge(),
): Promise<MemoryFact[]> {
  const raw = await requestJson("/api/memory", { label: "memory facts", signal, fetcher, bridge });
  if (!isRecord(raw) || !Array.isArray(raw.memories)) {
    throw new ApiError("The memory response is invalid.", 502);
  }
  return raw.memories.flatMap((row): MemoryFact[] => {
    if (!isRecord(row) || typeof row.id !== "string" || typeof row.text !== "string") return [];
    return [{
      id: row.id,
      text: row.text,
      createdAt: typeof row.createdAt === "number" ? row.createdAt : 0,
    }];
  });
}

export async function addMemoryFact(
  text: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  bridge: ShellBridge = detectShellBridge(),
): Promise<MemoryFact | null> {
  const raw = await requestJson("/api/memory", {
    method: "POST",
    body: { text: text.trim() },
    label: "memory save",
    signal,
    fetcher,
    bridge,
  });
  if (!isRecord(raw) || raw.ok !== true) {
    throw new ApiError("Could not save memory fact.", 502);
  }
  if (isRecord(raw.memory) && typeof raw.memory.id === "string" && typeof raw.memory.text === "string") {
    return {
      id: raw.memory.id,
      text: raw.memory.text,
      createdAt: typeof raw.memory.createdAt === "number" ? raw.memory.createdAt : Date.now(),
    };
  }
  return null;
}

export async function deleteMemoryFact(
  id: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  bridge: ShellBridge = detectShellBridge(),
): Promise<void> {
  const raw = await requestJson(`/api/memory?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    label: "memory removal",
    signal,
    fetcher,
    bridge,
  });
  if (!isRecord(raw) || raw.ok !== true) {
    throw new ApiError("Could not delete memory fact.", 502);
  }
}

export async function readMemoryBackupPreview(
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  bridge: ShellBridge = detectShellBridge(),
): Promise<MemoryBackupScan> {
  const raw = await requestJson("/api/v1/sys/memory-backup", {
    label: "memory backup preview",
    signal,
    fetcher,
    bridge,
  });
  return parseBackupScan(raw);
}

export async function readMemoryBackupHistory(
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  bridge: ShellBridge = detectShellBridge(),
  offset = 0,
): Promise<{ items: MemoryBackupHistoryEntry[]; nextOffset: number | null }> {
  const safeOffset = Math.max(0, Math.floor(offset));
  const raw = await requestJson(`/api/v1/sys/memory-backup?view=history&offset=${safeOffset}`, {
    label: "memory backup history",
    signal,
    fetcher,
    bridge,
  });
  if (!isRecord(raw) || !Array.isArray(raw.items)) {
    throw new ApiError("The memory backup history response is invalid.", 502);
  }
  const items: MemoryBackupHistoryEntry[] = raw.items.flatMap((row): MemoryBackupHistoryEntry[] => {
    if (!isRecord(row) || typeof row.id !== "string") return [];
    if (row.status === "readable" && isRecord(row.snapshot)) {
      const integrity =
        row.integrity === "verified-at-recorded-time" || row.integrity === "receipt-invalid"
          ? row.integrity
          : "not-recorded";
      return [{
        id: row.id,
        status: "readable",
        snapshot: parseBackupSummary(row.snapshot),
        integrity,
        ...(typeof row.verifiedAt === "string" ? { verifiedAt: row.verifiedAt } : {}),
      }];
    }
    return [{
      id: row.id,
      status: "unreadable",
      error: typeof row.error === "string" ? row.error : "snapshot-unreadable",
    }];
  });
  return {
    items,
    nextOffset: typeof raw.nextOffset === "number" ? raw.nextOffset : null,
  };
}

export async function createMemoryBackupSnapshot(
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  bridge: ShellBridge = detectShellBridge(),
): Promise<MemoryBackupSummary> {
  const raw = await requestJson("/api/v1/sys/memory-backup", {
    method: "POST",
    body: { action: "create", confirm: true },
    label: "memory backup snapshot",
    timeoutMs: 30_000,
    signal,
    fetcher,
    bridge,
  });
  return parseBackupSummary(raw);
}

export async function verifyMemoryBackupSnapshot(
  id: string,
  manifestSha256: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  bridge: ShellBridge = detectShellBridge(),
): Promise<MemoryBackupVerification> {
  const raw = await requestJson("/api/v1/sys/memory-backup", {
    method: "POST",
    body: { action: "verify", confirm: true, id, manifest_sha256: manifestSha256 },
    label: "memory backup verification",
    timeoutMs: 30_000,
    signal,
    fetcher,
    bridge,
  });
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.integrity !== "boolean") {
    throw new ApiError("The memory backup verification response is invalid.", 502);
  }
  return {
    id: raw.id,
    integrity: raw.integrity,
    restoredFiles: typeof raw.restoredFiles === "number" ? raw.restoredFiles : 0,
    restoreDirectory: typeof raw.restoreDirectory === "string" ? raw.restoreDirectory : "",
    complete: Boolean(raw.complete),
    sourceWritesPerformed: typeof raw.sourceWritesPerformed === "number" ? raw.sourceWritesPerformed : 0,
  };
}
