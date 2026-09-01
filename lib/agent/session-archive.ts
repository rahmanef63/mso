import { randomUUID } from "node:crypto";
import { constants as fsConstants, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import type { AgentSession } from "./session-types";
import { redactUnknown } from "@/lib/security/redact-text";

const gzipAsync = promisify(gzip);
const ARCHIVE_FILE = /^\d{8}_\d{6}_[a-f0-9]{8}__\d{8}T\d{6}Z__[a-z0-9-]+\.json\.gz$/;

function expandHome(value: string): string {
  return value.replace(/^~(?=$|\/)/, os.homedir());
}

export function agentSessionArchiveRoot(): string {
  return path.resolve(expandHome(process.env.OS_AGENT_SESSION_ARCHIVE_DIR || path.join(os.homedir(), ".mso", "agent-session-archive")));
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

export async function pruneAgentSessionArchives(now = Date.now()): Promise<{ removed: number; kept: number }> {
  const root = await secureRoot();
  const cutoff = now - archiveRetentionDays() * 86_400_000;
  const names = await fs.readdir(root).catch(() => [] as string[]);
  let removed = 0, kept = 0;
  for (const name of names) {
    if (!ARCHIVE_FILE.test(name)) continue;
    const file = path.join(root, name);
    let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
    try {
      handle = await fs.open(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
      const stat = await handle.stat();
      if (!stat.isFile() || (typeof process.getuid === "function" && stat.uid !== process.getuid())) continue;
      if (stat.mtimeMs >= cutoff) { kept++; continue; }
    } catch { continue; }
    finally { await handle?.close().catch(() => undefined); }
    await fs.unlink(file).then(() => { removed++; }).catch(() => undefined);
  }
  return { removed, kept };
}
