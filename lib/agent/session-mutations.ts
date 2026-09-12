import { withSecurityStoreLock } from "@/lib/security-store-lock";
import { redactText } from "@/lib/security/redact-text";
import { listSessionRecords, principalHash, sessionLockTarget, sessionNameLockTarget, writeSessionFile } from "./session-files";
import { requireAgentSessionName } from "./session-name";
import { autoSessionTitle, estimateTokens, MAX_EVENTS, MAX_HISTORY, safeTitle } from "./session-policy";
import { compactIfNeeded, requireOwned } from "./session-record";
import type { AgentSession, AgentSessionEvent, AgentSessionTitleSource } from "./session-types";

export async function updateAgentSessionHistory(
  principal: string,
  id: string,
  history: unknown[],
  title?: string,
  titleSource: AgentSessionTitleSource = "auto",
): Promise<AgentSession> {
  return withSecurityStoreLock(sessionLockTarget(id), async () => {
    let record = await requireOwned(principal, id);
    const oldTokens = estimateTokens(record.history),
      newHistory = Array.isArray(history) ? history.slice(-MAX_HISTORY) : [];
    record.history = newHistory;
    record.lifetimeEstimatedTokens += Math.max(
      0,
      estimateTokens(newHistory) - oldTokens,
    );
    const legacyCliDefault =
      record.source === "cli" &&
      record.titleSource === "manual" &&
      record.title === "MSO Agent session";
    if (
      title &&
      (titleSource === "manual" ||
        record.titleSource !== "manual" ||
        legacyCliDefault)
    ) {
      record.title = safeTitle(title);
      record.titleSource = titleSource;
    }
    record.updatedAt = new Date().toISOString();
    record = await compactIfNeeded(record, "context-threshold");
    await writeSessionFile(record);
    return record;
  });
}

export async function maybeAutoTitleAgentSession(
  principal: string,
  id: string,
  hint: string,
): Promise<AgentSession | null> {
  return withSecurityStoreLock(sessionLockTarget(id), async () => {
    const record = await requireOwned(principal, id);
    if (record.titleSource === "manual" || record.titleSource === "auto")
      return record;
    record.title = autoSessionTitle(hint);
    record.titleSource = "auto";
    record.updatedAt = new Date().toISOString();
    await writeSessionFile(record);
    return record;
  });
}

export async function renameAgentSessionName(
  principal: string,
  id: string,
  value: string,
): Promise<AgentSession> {
  const name = requireAgentSessionName(value);
  const owner = principalHash(principal);
  return withSecurityStoreLock(sessionNameLockTarget(owner), async () => {
    const duplicate = (await listSessionRecords()).find((row) =>
      row.principalHash === owner && row.id !== id && row.name === name,
    );
    if (duplicate) throw new Error(`session name @${name} is already in use`);
    return withSecurityStoreLock(sessionLockTarget(id), async () => {
      const record = await requireOwned(principal, id);
      record.name = name;
      record.updatedAt = new Date().toISOString();
      await writeSessionFile(record);
      return record;
    });
  });
}

export async function renameAgentSession(
  principal: string,
  id: string,
  title: string,
): Promise<AgentSession> {
  return withSecurityStoreLock(sessionLockTarget(id), async () => {
    const record = await requireOwned(principal, id);
    record.title = safeTitle(title);
    record.titleSource = "manual";
    record.updatedAt = new Date().toISOString();
    await writeSessionFile(record);
    return record;
  });
}

export async function appendAgentSessionEvent(
  principal: string,
  id: string,
  event: Omit<AgentSessionEvent, "at"> & { at?: string },
): Promise<void> {
  await withSecurityStoreLock(sessionLockTarget(id), async () => {
    let record = await requireOwned(principal, id);
    const at = event.at ?? new Date().toISOString();
    const row: AgentSessionEvent = {
      at,
      kind: event.kind,
      ...(event.tool ? { tool: event.tool.slice(0, 120) } : {}),
      ...(event.state ? { state: event.state.slice(0, 40) } : {}),
      ...(event.workflowId
        ? { workflowId: event.workflowId.slice(0, 80) }
        : {}),
      ...(event.detail
        ? {
            detail: redactText(
              event.detail.replace(/[\r\n\t]+/g, " ").trim(),
              500,
            ),
          }
        : {}),
    };
    record.events = [...record.events, row].slice(-MAX_EVENTS);
    record.updatedAt = at;
    record.lifetimeEstimatedTokens += estimateTokens(row);
    record = await compactIfNeeded(record, "event-threshold");
    await writeSessionFile(record);
  });
}

