type Entry = { windowId: string; value: unknown; sensitive: boolean };
const entries = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();
export const featureStateKey = (windowId: string, feature: string) => JSON.stringify([windowId, feature]);
export function readFeatureState<T>(key: string, initial: T): T {
  return entries.has(key) ? entries.get(key)!.value as T : initial;
}
export function writeFeatureState<T>(key: string, windowId: string, value: T, sensitive = false) {
  const previous = entries.get(key);
  const isSensitive = sensitive || previous?.sensitive === true;
  if (previous && Object.is(previous.value, value) && previous.sensitive === isSensitive) return;
  entries.set(key, { windowId, value, sensitive: isSensitive });
  listeners.get(key)?.forEach((notify) => notify());
}
export function subscribeFeatureState(key: string, notify: () => void) {
  const group = listeners.get(key) ?? new Set<() => void>();
  group.add(notify); listeners.set(key, group);
  return () => { group.delete(notify); if (!group.size) listeners.delete(key); };
}
/** Ephemeral UI state survives a shell remount, but never the owning window. */
export function pruneFeatureState(activeWindows: ReadonlySet<string>) {
  for (const [key, entry] of entries) {
    if (activeWindows.has(entry.windowId)) continue;
    entries.delete(key);
    listeners.get(key)?.forEach((notify) => notify());
  }
}

/** Release only sensitive drafts when authentication or privilege is lost. */
export function clearSensitiveFeatureState() {
  for (const [key, entry] of entries) {
    if (!entry.sensitive) continue;
    entries.delete(key);
    listeners.get(key)?.forEach((notify) => notify());
  }
}
