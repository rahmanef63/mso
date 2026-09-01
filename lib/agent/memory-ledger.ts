import { randomUUID } from "node:crypto";
import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";
import { resolveMemoryLedger } from "./memory-resolution";
import type { AgentMemoryDocument, AgentMemoryLedger, AgentMemoryRecord } from "./memory-types";

const LEDGER_NAME = "records-v1.json";
const MAX_LEDGER_BYTES = 2 * 1024 * 1024;
export const MAX_MEMORY_RECORDS = 2000;

export function ledgerFile(dir: string): string { return path.join(dir, LEDGER_NAME); }

export async function readMemoryLedger(dir: string): Promise<AgentMemoryLedger | null> {
  const file = ledgerFile(dir);
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_LEDGER_BYTES) throw new Error("agent memory ledger has an invalid file shape");
    if ((stat.mode & 0o077) !== 0) throw new Error("agent memory ledger permissions are too broad; expected 0600");
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error("agent memory ledger is not owned by the MSO user");
    const parsed = JSON.parse(await handle.readFile("utf8")) as AgentMemoryLedger;
    if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.records)) throw new Error("agent memory ledger has an invalid schema");
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  } finally { await handle?.close().catch(() => undefined); }
}

export async function writeMemoryLedger(dir: string, ledger: AgentMemoryLedger): Promise<void> {
  if (ledger.records.length > MAX_MEMORY_RECORDS) throw new Error(`agent memory ledger exceeds ${MAX_MEMORY_RECORDS} records`);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.chmod(dir, 0o700).catch(() => undefined);
  const file = ledgerFile(dir), tmp = `${file}.${randomUUID()}.tmp`;
  const body = JSON.stringify(ledger, null, 2);
  if (Buffer.byteLength(body, "utf8") > MAX_LEDGER_BYTES) throw new Error("agent memory ledger exceeds 2 MiB");
  await fs.writeFile(tmp, body, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await fs.chmod(tmp, 0o600); await fs.rename(tmp, file); await fs.chmod(file, 0o600);
}

export function parseLegacyDocument(document: AgentMemoryDocument, source: string, now: string): AgentMemoryRecord[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const out: AgentMemoryRecord[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("## ")) continue;
    const key = lines[i].slice(3).trim();
    const value: string[] = [];
    for (i += 1; i < lines.length && !lines[i].startsWith("## "); i++) value.push(lines[i]);
    i -= 1;
    const body = value.join("\n").trim();
    if (!key || !body) continue;
    out.push({
      id: `mem_${randomUUID()}`, document, key, value: body, kind: "semantic", confidence: 1,
      sensitivity: "normal", validFrom: now, createdAt: now,
      provenance: { authority: "migration", channel: "legacy", observedAt: now },
    });
  }
  return out;
}

export function seedLedger(user: string, memory: string, now = new Date().toISOString()): AgentMemoryLedger {
  return { schemaVersion: 1, updatedAt: now, records: [
    ...parseLegacyDocument("USER.md", user, now), ...parseLegacyDocument("MEMORY.md", memory, now),
  ] };
}

export function materializeDocuments(ledger: AgentMemoryLedger, at = new Date().toISOString()): Record<AgentMemoryDocument, string> {
  const grouped: Record<AgentMemoryDocument, string[]> = { "USER.md": [], "MEMORY.md": [] };
  for (const { record } of resolveMemoryLedger(ledger, at)) grouped[record.document].push(`## ${record.key}\n${record.value}`);
  return { "USER.md": grouped["USER.md"].length ? `${grouped["USER.md"].join("\n\n")}\n` : "", "MEMORY.md": grouped["MEMORY.md"].length ? `${grouped["MEMORY.md"].join("\n\n")}\n` : "" };
}
