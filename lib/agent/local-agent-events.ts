import type { LocalAgentMessageView } from "./local-agent-types";

type Listener = (message: LocalAgentMessageView) => void;
const listeners = new Map<string, Set<Listener>>();
const standbyListeners = new Map<string, Set<Listener>>();

function subscribe(registry: Map<string, Set<Listener>>, sessionId: string, listener: Listener): () => void {
  const set = registry.get(sessionId) ?? new Set<Listener>();
  set.add(listener);
  registry.set(sessionId, set);
  return () => {
    set.delete(listener);
    if (!set.size) registry.delete(sessionId);
  };
}

function publish(registry: Map<string, Set<Listener>>, sessionId: string, message: LocalAgentMessageView): number {
  let delivered = 0;
  for (const listener of registry.get(sessionId) ?? []) {
    try {
      listener(message);
      delivered += 1;
    } catch {
      // Durable mailbox remains authoritative when a listener disappears mid-send.
    }
  }
  return delivered;
}

/** Foreground receiver subscription. This is the ONLY registry counted by consumerConnected. */
export function subscribeLocalAgentMessages(sessionId: string, listener: Listener): () => void {
  return subscribe(listeners, sessionId, listener);
}

/** Server-native standby subscription. Intentionally excluded from consumerConnected. */
export function subscribeLocalAgentStandbyMessages(sessionId: string, listener: Listener): () => void {
  return subscribe(standbyListeners, sessionId, listener);
}

export function publishLocalAgentMessage(sessionId: string, message: LocalAgentMessageView): number {
  return publish(listeners, sessionId, message);
}

export function publishLocalAgentStandbyMessage(sessionId: string, message: LocalAgentMessageView): number {
  return publish(standbyListeners, sessionId, message);
}

export function localAgentSubscriberCount(sessionId: string): number {
  return listeners.get(sessionId)?.size ?? 0;
}

export function localAgentStandbySubscriberCount(sessionId: string): number {
  return standbyListeners.get(sessionId)?.size ?? 0;
}

export function localAgentConsumerConnected(sessionId: string): boolean {
  return localAgentSubscriberCount(sessionId) > 0;
}
