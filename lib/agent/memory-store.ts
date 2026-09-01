import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { withSecurityStoreLock } from "@/lib/security-store-lock";

export type AgentMemoryDocument = "USER.md" | "MEMORY.md";
export interface AgentMemorySnapshot {
  capturedAt: string;
  user: string;
  memory: string;
}

const ROOT = path.resolve(process.env.OS_AGENT_MEMORY_DIR || path.join(os.homedir(), ".mso", "agent-memory"));
const MAX_DOC_BYTES = 64 * 1024;
const KEY_RE = /^[^\r\n]{1,80}$/;

function principalKey(principal: string): string {
  if (!principal || principal.length > 512) throw new Error("invalid agent memory principal");
  return createHash("sha256").update(principal).digest("hex").slice(0, 32);
}

function dirFor(principal: string): string {
  return path.join(ROOT, principalKey(principal));
}

function fileFor(principal: string, document: AgentMemoryDocument): string {
  if (document !== "USER.md" && document !== "MEMORY.md") throw new Error("invalid memory document");
  return path.join(dirFor(principal), document);
}

async function readDocument(principal: string, document: AgentMemoryDocument): Promise<string> {
  const file = fileFor(principal, document);
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error("agent memory must be a regular file");
    if (stat.size > MAX_DOC_BYTES) throw new Error("agent memory document is too large");
    if ((stat.mode & 0o077) !== 0) throw new Error("agent memory permissions are too broad; expected 0600");
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error("agent memory is not owned by the MSO user");
    return await handle.readFile("utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function writeDocument(principal: string, document: AgentMemoryDocument, content: string): Promise<void> {
  if (Buffer.byteLength(content, "utf8") > MAX_DOC_BYTES) throw new Error("agent memory document exceeds 64 KiB");
  const file = fileFor(principal, document);
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.chmod(ROOT, 0o700).catch(() => undefined);
  await fs.chmod(dir, 0o700).catch(() => undefined);
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await fs.chmod(tmp, 0o600);
  await fs.rename(tmp, file);
  await fs.chmod(file, 0o600);
}

function cleanKey(key: string): string {
  const normalized = key.trim();
  if (!KEY_RE.test(normalized) || normalized.startsWith("#")) throw new Error("memory key must be one line, 1-80 characters");
  return normalized;
}

function cleanValue(value: string): string {
  const normalized = value.trim();
  if (!normalized || Buffer.byteLength(normalized, "utf8") > 8 * 1024) throw new Error("memory value must be 1-8192 bytes");
  return normalized;
}

function replaceSection(source: string, key: string, value: string | null): string {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const heading = `## ${key}`;
  const start = lines.findIndex((line) => line === heading);
  let next = lines.length;
  if (start >= 0) {
    for (let i = start + 1; i < lines.length; i++) {
      if (lines[i].startsWith("## ")) { next = i; break; }
    }
    lines.splice(start, next - start);
  }
  if (value !== null) {
    while (lines.length && !lines.at(-1)?.trim()) lines.pop();
    if (lines.length) lines.push("");
    lines.push(heading, value, "");
  }
  return lines.join("\n").trim() ? `${lines.join("\n").trim()}\n` : "";
}

export async function snapshotAgentMemory(principal: string): Promise<AgentMemorySnapshot> {
  const [user, memory] = await Promise.all([
    readDocument(principal, "USER.md"),
    readDocument(principal, "MEMORY.md"),
  ]);
  return { capturedAt: new Date().toISOString(), user, memory };
}

export async function readAgentMemory(principal: string): Promise<AgentMemorySnapshot> {
  return snapshotAgentMemory(principal);
}

export async function rememberAgentMemory(
  principal: string,
  document: AgentMemoryDocument,
  key: string,
  value: string,
): Promise<AgentMemorySnapshot> {
  const safeKey = cleanKey(key);
  const safeValue = cleanValue(value);
  const file = fileFor(principal, document);
  await withSecurityStoreLock(file, async () => {
    const current = await readDocument(principal, document);
    await writeDocument(principal, document, replaceSection(current, safeKey, safeValue));
  });
  return snapshotAgentMemory(principal);
}

export async function forgetAgentMemory(
  principal: string,
  document: AgentMemoryDocument,
  key: string,
): Promise<AgentMemorySnapshot> {
  const safeKey = cleanKey(key);
  const file = fileFor(principal, document);
  await withSecurityStoreLock(file, async () => {
    const current = await readDocument(principal, document);
    await writeDocument(principal, document, replaceSection(current, safeKey, null));
  });
  return snapshotAgentMemory(principal);
}
