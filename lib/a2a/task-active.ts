const active = new Map<string, AbortController>();
const profiles = new Map<string, string>();

export function registerA2AActiveTask(
  id: string,
  controller: AbortController,
  profileId?: string,
): void {
  active.set(id, controller);
  if (profileId) profiles.set(id, profileId);
}

export function releaseA2AActiveTask(id: string): void {
  active.delete(id);
  profiles.delete(id);
}

export function isA2ATaskActive(id: string): boolean {
  return active.has(id);
}

export function abortA2AActiveTask(id: string): void {
  active.get(id)?.abort(new Error("A2A task canceled"));
}

export function abortA2AProfileTasks(profileId: string): void {
  for (const [id, owner] of profiles) if (owner === profileId) active.get(id)?.abort(new Error("A2A authorization revoked"));
}
