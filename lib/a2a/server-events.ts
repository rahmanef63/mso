import type { A2ATaskRecord } from "./tasks";

export type A2AStreamResponse = Record<string, unknown>;
type Listener = (event: A2AStreamResponse) => void;
const listeners = new Map<string, Set<Listener>>();
const streams = new Map<() => void, string>();

export function registerA2AStream(profileId: string, close: () => void): (() => void) | null {
  if (streams.size >= 64 || [...streams.values()].filter(id=>id===profileId).length >= 8) return null;
  streams.set(close,profileId);
  return () => { streams.delete(close); };
}

export function closeA2AProfileStreams(profileId: string): void {
  for (const [close,id] of streams) if (id===profileId) close();
}

export function publishA2AEvent(taskId: string, event: A2AStreamResponse) {
  for (const listener of listeners.get(taskId) ?? []) {
    try {
      listener(event);
    } catch {
      // A disconnected observer must never affect task execution.
    }
  }
}

export function subscribeA2AEvent(
  taskId: string,
  listener: Listener,
): () => void {
  const set = listeners.get(taskId) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(taskId, set);
  return () => {
    set.delete(listener);
    if (!set.size) listeners.delete(taskId);
  };
}

export function a2aStatusUpdate(task: A2ATaskRecord): A2AStreamResponse {
  return {
    statusUpdate: {
      taskId: task.id,
      contextId: task.contextId,
      status: task.status,
      metadata: { "mso.scope": task.scope },
    },
  };
}

export function a2aArtifactUpdate(
  task: A2ATaskRecord,
  text: string,
  append: boolean,
  lastChunk: boolean,
): A2AStreamResponse {
  return {
    artifactUpdate: {
      taskId: task.id,
      contextId: task.contextId,
      artifact: {
        artifactId: `artifact_${task.id}`,
        name: "result",
        parts: [{ text, mediaType: "text/plain" }],
      },
      append,
      lastChunk,
    },
  };
}
