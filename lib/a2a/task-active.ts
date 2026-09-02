const active = new Map<string, AbortController>();

export function registerA2AActiveTask(
  id: string,
  controller: AbortController,
): void {
  active.set(id, controller);
}

export function releaseA2AActiveTask(id: string): void {
  active.delete(id);
}

export function isA2ATaskActive(id: string): boolean {
  return active.has(id);
}

export function abortA2AActiveTask(id: string): void {
  active.get(id)?.abort(new Error("A2A task canceled"));
}
