import type { LocalAgentMessageView } from "./local-agent-types";

type Listener = (message: LocalAgentMessageView) => void;
const listeners = new Map<string, Set<Listener>>();

export function subscribeLocalAgentMessages(sessionId: string, listener: Listener): () => void {
  const set = listeners.get(sessionId) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(sessionId, set);
  return () => {
    set.delete(listener);
    if (!set.size) listeners.delete(sessionId);
  };
}

export function publishLocalAgentMessage(sessionId: string, message: LocalAgentMessageView): number {
  let delivered = 0;
  for (const listener of listeners.get(sessionId) ?? []) {
    try {
      listener(message);
      delivered += 1;
    } catch {
      // Durable mailbox remains authoritative when a listener disappears mid-send.
    }
  }
  return delivered;
}

export function localAgentSubscriberCount(sessionId: string): number {
  return listeners.get(sessionId)?.size ?? 0;
}

export function localAgentConsumerConnected(sessionId: string): boolean {
  return localAgentSubscriberCount(sessionId) > 0;
}
