import { createHash, randomUUID } from "node:crypto";
import { sessionPreservation } from "./session-preservation";
import { constants as fsConstants, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";
import type { AgentSession } from "./session-types";
import { redactUnknown } from "@/lib/security/redact-text";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const ARCHIVE_FILE = /^\d{8}_\d{6}_[a-f0-9]{8}__\d{8}T\d{6}Z__[a-z0-9-]+\.json\.gz$/;

function expandHome(value: string): string {
  return value.replace(/^~(?=$|\/)/, os.homedir());
}

export function agentSessionArchiveRoot(): string {
  return path.resolve(expandHome(process.env.OS_AGENT_SESSION_ARCHIVE_DIR || path.join(os.homedir(), ".mso", "agent-session-archive")));
}

export function agentSessionPreservationRoot(): string {
  return path.resolve(expandHome(process.env.OS_AGENT_SESSION_PRESERVATION_DIR || path.join(os.homedir(), ".mso", "agent-session-preservation")));
}

export function archiveRetentionDays(): number {
  const raw = Number(process.env.OS_AGENT_SESSION_ARCHIVE_DAYS);
  return Number.isFinite(raw) ? Math.max(1, Math.min(365, Math.trunc(raw))) : 30;
}

function stamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function safeReason(reason: string): string {
  return reason.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "backup";
}

async function secureRoot(): Promise<string> {
  const root = agentSessionArchiveRoot();
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  await fs.chmod(root, 0o700).catch(() => undefined);
  return root;
}

async function securePreservationRoot(): Promise<string> {
  const root = agentSessionPreservationRoot();
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  await fs.chmod(root, 0o700).catch(() => undefined);
  return root;
}

function receiptName(archiveName: string): string {
  if (!ARCHIVE_FILE.test(archiveName)) throw new Error("invalid agent session archive name");
  return `${archiveName}.jev.json`;
}

async function archiveSha256(file: string): Promise<string> {
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > 32 * 1024 * 1024) throw new Error("agent session archive has an invalid file shape");
    if ((stat.mode & 0o077) !== 0) throw new Error("agent session archive permissions are too broad; expected 0600");
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error("agent session archive is not owned by the MSO user");
    return createHash("sha256").update(await handle.readFile()).digest("hex");
  } finally { await handle?.close().catch(() => undefined); }
}

export async function listAgentSessionArchives(): Promise<Array<{ name: string; bytes: number; mtimeMs: number }>> {
  const root = await secureRoot();
  const names = (await fs.readdir(root).catch(() => [] as string[])).filter((name) => ARCHIVE_FILE.test(name)).sort();
  const out: Array<{ name: string; bytes: number; mtimeMs: number }> = [];
  for (const name of names) {
    try {
      const stat = await fs.stat(path.join(root, name));
      if (stat.isFile()) out.push({ name, bytes: stat.size, mtimeMs: stat.mtimeMs });
    } catch { /* file raced with another maintenance pass */ }
  }
  return out;
}

export async function readAgentSessionArchive(name: string): Promise<{ schemaVersion: 1; archivedAt: string; reason: string; session: AgentSession; sha256: string }> {
  if (!ARCHIVE_FILE.test(name)) throw new Error("invalid agent session archive name");
  const file = path.join(await secureRoot(), name);
  const sha256 = await archiveSha256(file);
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const raw = JSON.parse((await gunzipAsync(await handle.readFile())).toString("utf8")) as { schemaVersion?: unknown; archivedAt?: unknown; reason?: unknown; session?: AgentSession };
    if (raw.schemaVersion !== 1 || typeof raw.archivedAt !== "string" || typeof raw.reason !== "string" || !raw.session?.id) throw new Error("agent session archive has an invalid payload");
    return { schemaVersion: 1, archivedAt: raw.archivedAt, reason: raw.reason, session: raw.session, sha256 };
  } finally { await handle?.close().catch(() => undefined); }
}

export async function writeAgentSessionArchiveJevReceipt(archiveName: string, archiveSha: string, receipt: Record<string, unknown>): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(archiveSha)) throw new Error("invalid agent session archive digest");
  const root = await securePreservationRoot(), file = path.join(root, receiptName(archiveName));
  const body = JSON.stringify(redactUnknown({ ...receipt, schemaVersion: 1, kind: "mso.jev-archive-preservation.v1", archiveName, archiveSha256: archiveSha, preservedAt: new Date().toISOString(), provider: "jev" }), null, 2);
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, body, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await fs.chmod(tmp, 0o600); await fs.rename(tmp, file); await fs.chmod(file, 0o600);
}

export async function hasAgentSessionArchiveJevReceipt(archiveName: string, archiveFile?: string): Promise<boolean> {
  try {
    const file = archiveFile ?? path.join(await secureRoot(), archiveName), sha = await archiveSha256(file);
    const receiptFile = path.join(await securePreservationRoot(), receiptName(archiveName));
    const raw = JSON.parse(await fs.readFile(receiptFile, "utf8")) as Record<string, unknown>;
    return raw.schemaVersion === 1 && raw.kind === "mso.jev-archive-preservation.v1" && raw.provider === "jev" && raw.archiveName === archiveName && raw.archiveSha256 === sha;
  } catch { return false; }
}

export async function archiveAgentSession(record: AgentSession, reason: string, now = new Date()): Promise<string> {
  const root = await secureRoot();
  const name = `${record.id}__${stamp(now)}__${safeReason(reason)}.json.gz`;
  if (!ARCHIVE_FILE.test(name)) throw new Error("invalid agent session archive name");
  const target = path.join(root, name);
  const payload = Buffer.from(JSON.stringify(redactUnknown({ schemaVersion: 1, archivedAt: now.toISOString(), reason, session: record }), null, 2));
  const compressed = await gzipAsync(payload, { level: 9 });
  const tmp = `${target}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, compressed, { mode: 0o600, flag: "wx" });
  await fs.chmod(tmp, 0o600);
  await fs.rename(tmp, target);
  await fs.chmod(target, 0o600);
  return target;
}

export async function pruneAgentSessionArchives(now = Date.now()): Promise<{ removed: number; kept: number; blocked: number }> {
  const root = await secureRoot();
  const cutoff = now - archiveRetentionDays() * 86_400_000;
  const names = await fs.readdir(root).catch(() => [] as string[]);
  let removed = 0, kept = 0, blocked = 0;
  for (const name of names) {
    if (!ARCHIVE_FILE.test(name)) continue;
    if ((await sessionPreservation(name.split("__")[0])).protected) { blocked++; kept++; continue; }
    const file = path.join(root, name);
    let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
    try {
      handle = await fs.open(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
      const stat = await handle.stat();
      if (!stat.isFile() || (typeof process.getuid === "function" && stat.uid !== process.getuid())) continue;
      if (stat.mtimeMs >= cutoff) { kept++; continue; }
    } catch { continue; }
    finally { await handle?.close().catch(() => undefined); }
    if (!(await hasAgentSessionArchiveJevReceipt(name, file))) { blocked++; kept++; continue; }
    await fs.unlink(file).then(() => { removed++; }).catch(() => undefined);
  }
  if (blocked === 0) {
    try {
      const { pruneSessionActionIndexes } = await import("./session-action-history");
      removed += await pruneSessionActionIndexes(now);
    } catch { /* action-index pruning is best-effort */ }
  }
  return { removed, kept, blocked };
}
