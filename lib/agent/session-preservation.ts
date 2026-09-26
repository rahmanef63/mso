import { createHash } from "node:crypto";
import path from "node:path";
import { withSecurityStoreLock } from "@/lib/security-store-lock";
import { readWorkflowJson, writeWorkflowFile } from "@/lib/workflow/private-file";
import { agentSessionsDir, SESSION_ID } from "./session-paths";

export type PreservationRecord = {
  version: 1;
  sessionId: string;
  pinned: boolean;
  state: "unreviewed" | "reviewed";
  updatedAt: string;
  reviewedThrough?: string;
  evidenceRef?: string;
};
export type PreservationDecision = { protected: boolean; reason: string; record: PreservationRecord | null };
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function file(id: string): string {
  if (!SESSION_ID.test(id)) throw new Error("invalid session id");
  return path.join(agentSessionsDir(), ".preservation", `${id}.json`);
}

export async function readSessionPreservation(id: string): Promise<PreservationRecord | null> {
  try {
    const row = await readWorkflowJson(file(id), 8192, "session preservation receipt") as PreservationRecord;
    if (row.version !== 1 || row.sessionId !== id || typeof row.pinned !== "boolean" ||
      !["unreviewed", "reviewed"].includes(row.state) || !Number.isFinite(Date.parse(row.updatedAt))) {
      throw new Error("invalid session preservation receipt");
    }
    return row;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Review is knowledge provenance, NOT authorization to delete the source.
 * Until a restore-verified, per-artifact release receipt exists, retention is
 * deliberately fail-closed. No age, successful workflow, or model score can
 * authorize destroying raw evidence. Old installations default to protected. */
export function preservationDecision(record: PreservationRecord | null): PreservationDecision {
  if (!record) return { protected: true, reason: "unreviewed", record };
  if (record.pinned) return { protected: true, reason: "pinned", record };
  return { protected: true, reason: record.state === "reviewed" ? "source-release-not-approved" : "unreviewed", record };
}

export async function sessionPreservation(id: string): Promise<PreservationDecision & { revision: string }> {
  try {
    const record = await readSessionPreservation(id);
    return { ...preservationDecision(record), revision: digest(record) };
  } catch {
    return { protected: true, reason: "preservation-unavailable", record: null, revision: "unavailable" };
  }
}

/** Caller must prove session access and an owner role before changing this receipt. */
export async function updateSessionPreservation(id: string, expectedRevision: string,
  change: { pinned?: boolean; reviewedThrough?: string; evidenceRef?: string }): Promise<PreservationRecord> {
  return withSecurityStoreLock(file(id), async () => {
    const prior = await readSessionPreservation(id);
    if (expectedRevision !== digest(prior)) throw new Error("preservation changed; refresh before editing");
    if (change.reviewedThrough !== undefined && !Number.isFinite(Date.parse(change.reviewedThrough))) throw new Error("invalid review timestamp");
    if (change.reviewedThrough && (!change.evidenceRef || !/^[a-zA-Z0-9_.:-]{1,160}$/.test(change.evidenceRef))) throw new Error("review evidence reference required");
    const next: PreservationRecord = {
      version: 1, sessionId: id, pinned: change.pinned ?? prior?.pinned ?? false,
      state: change.reviewedThrough ? "reviewed" : prior?.state ?? "unreviewed", updatedAt: new Date().toISOString(),
      ...(prior?.reviewedThrough ? { reviewedThrough: prior.reviewedThrough, evidenceRef: prior.evidenceRef } : {}),
      ...(change.reviewedThrough ? { reviewedThrough: change.reviewedThrough, evidenceRef: change.evidenceRef } : {}),
    };
    await writeWorkflowFile(file(id), JSON.stringify(next));
    return next;
  });
}
