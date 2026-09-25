import { createHash, randomUUID } from "node:crypto";
import { sessionPreservation } from "./session-preservation";
import { writeWorkflowFile } from "@/lib/workflow/private-file";
import { constants, promises as fs } from "node:fs";
import path from "node:path";
import { withSecurityStoreLock } from "@/lib/security-store-lock";
import { redactText } from "@/lib/security/redact-text";
import { agentSessionArchiveRoot, archiveRetentionDays } from "./session-archive";
import { validSessionArtifactRevision } from "./session-artifact-history";
import type { AgentSession, AgentSessionEvent } from "./session-types";

export const MAX_BYTES = 4 * 1024 * 1024;
const MAX_ACTION_RECORDS = 5000;
const KINDS = new Set(["created", "resumed", "tool", "workflow", "note", "compacted", "archived"]);
export const INDEX_FILE = /^(\d{8}_\d{6}_[a-f0-9]{8})__actions\.json$/;

type ArchivedActionRecord = { sequence: number; event: AgentSessionEvent };
type ArchivedActionIndex = {
  schemaVersion: 1;
  sessionId: string;
  principalHash: string;
  cwd?: string;
  updatedAt: string;
  records: ArchivedActionRecord[];
};

function validEvent(value: unknown): value is AgentSessionEvent {
  if (!value || typeof value !== "object") return false;
  const row = value as AgentSessionEvent;
  return typeof row.at === "string" && Number.isFinite(Date.parse(row.at)) && KINDS.has(row.kind) &&
    ["tool", "state", "workflowId", "detail"].every((key) => row[key as keyof AgentSessionEvent] === undefined || (typeof row[key as keyof AgentSessionEvent] === "string" && String(row[key as keyof AgentSessionEvent]).length <= 16000)) &&
    (row.semantic === undefined || (row.semantic.version === 1 && Number.isSafeInteger(row.semantic.step) && row.semantic.step > 0 &&
      Number.isSafeInteger(row.semantic.action) && row.semantic.action > 0 &&
      ["context", "plan", "inspect", "implement", "verify", "integrate", "deploy", "result", "other"].includes(row.semantic.category))) &&
    (row.artifactRevision === undefined || validSessionArtifactRevision(row.artifactRevision));
}
export function validActionEvents(value: unknown): value is AgentSessionEvent[] {
  return Array.isArray(value) && value.length <= 10000 && value.every(validEvent);
}
function safeEvent(event: AgentSessionEvent): AgentSessionEvent {
  return {
    at: new Date(event.at).toISOString(), kind: event.kind,
    ...(event.tool ? { tool: event.tool.slice(0, 120) } : {}),
    ...(event.state ? { state: event.state.slice(0, 40) } : {}),
    ...(event.workflowId ? { workflowId: event.workflowId.slice(0, 80) } : {}),
    ...(event.detail ? { detail: redactText(event.detail, 500) } : {}),
    ...(event.semantic ? { semantic: event.semantic } : {}),
    ...(event.artifactRevision && validSessionArtifactRevision(event.artifactRevision) ? { artifactRevision: event.artifactRevision } : {}),
  };
}
export function actionIndexPath(sessionId: string): string {
  if (!/^\d{8}_\d{6}_[a-f0-9]{8}$/.test(sessionId)) throw new Error("invalid agent session id");
  return path.join(agentSessionArchiveRoot(), `${sessionId}__actions.json`);
}
export async function secureArchiveRoot(): Promise<string> {
  const root = agentSessionArchiveRoot();
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  await fs.chmod(root, 0o700).catch(() => undefined);
  const stat = await fs.lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) || (typeof process.getuid === "function" && stat.uid !== process.getuid())) throw new Error("unsafe agent session archive root");
  return root;
}
export async function readActionIndex(target: string): Promise<ArchivedActionIndex | null> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_BYTES || (stat.mode & 0o077) || (typeof process.getuid === "function" && stat.uid !== process.getuid())) return null;
    const body = await handle.readFile("utf8");
    const parsed = JSON.parse(body) as Partial<ArchivedActionIndex>;
    if (parsed.schemaVersion !== 1 || typeof parsed.sessionId !== "string" || typeof parsed.principalHash !== "string" || !Array.isArray(parsed.records) || parsed.records.length > MAX_ACTION_RECORDS) return null;
    const records = parsed.records.filter((row): row is ArchivedActionRecord => Boolean(row && Number.isSafeInteger(row.sequence) && row.sequence > 0 && validEvent(row.event)));
    return { schemaVersion: 1, sessionId: parsed.sessionId, principalHash: parsed.principalHash, ...(typeof parsed.cwd === "string" ? { cwd: parsed.cwd.slice(0, 4096) } : {}), updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(), records };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  } finally { await handle?.close().catch(() => undefined); }
}

/** Persist only events that are about to leave the hot 400-event session ledger. */
export async function archiveDroppedSessionEvents(session: Pick<AgentSession, "id" | "principalHash" | "cwd">, dropped: AgentSessionEvent[], eventSeqBase: number): Promise<void> {
  if (!dropped.length) return;
  await secureArchiveRoot();
  const target = actionIndexPath(session.id), cutoff = Date.now() - archiveRetentionDays() * 86_400_000;
  await withSecurityStoreLock(target, async () => {
    const current = await readActionIndex(target);
    if (current && (current.sessionId !== session.id || current.principalHash !== session.principalHash)) throw new Error("session action index owner mismatch");
    const preserve = (await sessionPreservation(session.id)).protected;
    const existing = current?.records.filter((row) => preserve || Date.parse(row.event.at) >= cutoff) ?? [];
    const bySequence = new Map(existing.map((row) => [row.sequence, row]));
    dropped.forEach((event, index) => bySequence.set(eventSeqBase + index + 1, { sequence: eventSeqBase + index + 1, event: safeEvent(event) }));
    const ordered = [...bySequence.values()].sort((a, b) => a.sequence - b.sequence);
    if (preserve && ordered.length > MAX_ACTION_RECORDS) {
      const overflow = ordered.slice(0, -MAX_ACTION_RECORDS);
      const segment = JSON.stringify({ schemaVersion: 1, sessionId: session.id, principalHash: session.principalHash, cwd: session.cwd, updatedAt: new Date().toISOString(), records: overflow });
      if (Buffer.byteLength(segment) > MAX_BYTES) throw new Error("preserved action segment exceeds limit");
      await writeWorkflowFile(path.join(agentSessionArchiveRoot(), `${session.id}__actions-part-${createHash("sha256").update(segment).digest("hex")}.json`), segment);
    }
    const records = ordered.slice(-MAX_ACTION_RECORDS);
    const next: ArchivedActionIndex = { schemaVersion: 1, sessionId: session.id, principalHash: session.principalHash, ...(session.cwd ? { cwd: session.cwd } : {}), updatedAt: new Date().toISOString(), records };
    const body = JSON.stringify(next) + "\n";
    if (Buffer.byteLength(body) > MAX_BYTES) throw new Error("session action index exceeds 4 MiB");
    const tmp = `${target}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmp, body, { flag: "wx", mode: 0o600 });
      await fs.rename(tmp, target);
      await fs.chmod(target, 0o600).catch(() => undefined);
    } finally { await fs.unlink(tmp).catch(() => undefined); }
  });
}

/** Bounded immutable overflow segments; contents stay subject to the same index validation. */
export async function readActionSegments(sessionId: string) {
  const root = await secureArchiveRoot(), names: string[] = [];
  let seen = 0;
  for await (const entry of await fs.opendir(root)) {
    if (++seen > 10000) break;
    if (entry.isFile() && entry.name.startsWith(`${sessionId}__actions-part-`) &&
      /^\d{8}_\d{6}_[a-f0-9]{8}__actions-part-[a-f0-9]{64}\.json$/.test(entry.name)) names.push(entry.name);
  }
  return names.sort().reverse().slice(0, 64).map(name => path.join(root, name));
}
