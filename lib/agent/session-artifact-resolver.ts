import type { AgentSession } from "./session-types";
import { resolveHistoricalSessionActionRecord, resolveHistoricalSessionActionRecordForOwner } from "./session-action-history";
import { resolveArtifactRevisionView } from "./session-artifact-history";

export async function resolveHistoricalSessionArtifact(principal: string, session: AgentSession, actionRef: string) {
  const record = await resolveHistoricalSessionActionRecord(principal, session, actionRef);
  if (!record) return null;
  const artifact = record.resolution.action.artifact;
  if (!artifact) return { resolution: record.resolution, artifact: null, history: null };
  return {
    resolution: record.resolution,
    artifact,
    history: await resolveArtifactRevisionView(record.event.artifactRevision),
  };
}

/** Owner-console variant. The API route must verify owner role before calling this. */
export async function resolveHistoricalSessionArtifactForOwner(session: AgentSession, actionRef: string) {
  const record = await resolveHistoricalSessionActionRecordForOwner(session, actionRef);
  if (!record) return null;
  const artifact = record.resolution.action.artifact;
  if (!artifact) return { resolution: record.resolution, artifact: null, history: null };
  return { resolution: record.resolution, artifact, history: await resolveArtifactRevisionView(record.event.artifactRevision) };
}
