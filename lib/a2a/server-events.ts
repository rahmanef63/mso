import type { A2ATaskRecord } from "./tasks";

export type A2AStreamResponse = Record<string, unknown>;
type Listener = (event: A2AStreamResponse) => void;
const listeners = new Map<string, Set<Listener>>();

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
