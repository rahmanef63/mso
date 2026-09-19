import { buildMemoryContext } from "@/lib/agent/memory-context.mjs";
import { getAgentSession } from "@/lib/agent/session-store";

type SessionContext = { principal?: string; sessionId?: string };

export async function workflowStartAgentMemory(context: SessionContext, intent: string) {
  if (!context.principal || !context.sessionId) return [];
  const session = await getAgentSession(context.principal, context.sessionId).catch(() => null);
  if (!session) return [];
  return buildMemoryContext(session.memorySnapshot || {}, intent, {
    coreChars: 0, jitChars: 6000, maxRelevant: 5,
  }).relevantEntries;
}
