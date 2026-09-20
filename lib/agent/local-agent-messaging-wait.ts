import { listLocalAgents } from "./local-agent-directory";
import {
  findLocalAgentReply,
  getLocalAgentSentMessage,
  listLocalAgentInbox,
} from "./local-agent-mailbox";
import { subscribeLocalAgentMessages } from "./local-agent-events";
import type { LocalAgentMessageView } from "./local-agent-types";

export const MAX_LOCAL_AGENT_INBOX_WAIT_MS = 20_000;

export async function waitForLocalAgentInbox(input: {
  principal: string;
  sessionId: string;
  includeRead?: boolean;
  limit?: number;
  waitMs?: number;
}): Promise<LocalAgentMessageView[]> {
  const limit = Math.max(1, Math.min(200, Math.trunc(input.limit ?? 100)));
  const waitMs = Number.isFinite(input.waitMs)
    ? Math.max(0, Math.min(MAX_LOCAL_AGENT_INBOX_WAIT_MS, Math.trunc(input.waitMs ?? 0)))
    : 0;
  const read = () => listLocalAgentInbox(input.principal, input.sessionId, {
    includeRead: input.includeRead === true,
    limit,
  });
  const initial = await read();
  if (initial.length || waitMs === 0) return initial;

  let wake = () => {};
  const signalled = new Promise<void>((resolve) => { wake = resolve; });
  const unsubscribe = subscribeLocalAgentMessages(input.sessionId, () => wake());
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Close the read→subscribe race; durable mailbox remains authoritative.
    const afterSubscribe = await read();
    if (afterSubscribe.length) return afterSubscribe;
    const timedOut = new Promise<void>((resolve) => { timer = setTimeout(resolve, waitMs); });
    await Promise.race([signalled, timedOut]);
    return read();
  } finally {
    if (timer) clearTimeout(timer);
    unsubscribe();
  }
}

export async function waitForLocalAgentReply(input: {
  principal: string;
  senderSessionId: string;
  requestMessageId: string;
  timeoutMs?: number;
}) {
  const request = await getLocalAgentSentMessage(
    input.principal,
    input.senderSessionId,
    input.requestMessageId,
  );
  if (!request || request.intent !== "request" || !request.correlationId)
    throw new Error("correlated local agent request not found for this session");
  const timeoutMs = Math.max(0, Math.min(30_000, Math.trunc(input.timeoutMs ?? 5_000)));
  const startedAt = Date.now();
  while (true) {
    const reply = await findLocalAgentReply(input.principal, input.senderSessionId, request.id);
    const target = (await listLocalAgents(input.principal, { includeOffline: true }))
      .find((row) => row.id === request.targetSessionId) ?? null;
    const elapsedMs = Date.now() - startedAt;
    if (reply) return { state: "replied" as const, elapsedMs, request, reply, target };
    if (target && !target.actionable && ["offline", "ended"].includes(target.status))
      return { state: "target_offline" as const, elapsedMs, request, reply: null, target };
    if (elapsedMs >= timeoutMs) {
      const state = target?.actionable === false
        ? "consumer_absent" as const
        : "timeout" as const;
      return { state, elapsedMs, request, reply: null, target };
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(100, Math.max(1, timeoutMs - elapsedMs))));
  }
}
