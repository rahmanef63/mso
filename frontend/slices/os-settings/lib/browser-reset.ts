import { MSO_LOCAL_STATE } from "@/features/appshell";

export type BrowserResetScope = "appearance" | "browser";

/** Snapshot before removal: Storage keys shift after each mutation. Identity is retained. */
export function browserResetKeys(storage: Storage, scope: BrowserResetScope): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key || key === "mso.device.id") continue;
    const owned = MSO_LOCAL_STATE.prefixes.some((prefix) => key.startsWith(prefix)) || MSO_LOCAL_STATE.extra.includes(key);
    if (scope === "appearance" ? key === "mso:tweaks" : owned) keys.push(key);
  }
  return keys;
}
export function resetBrowserState(storage: Storage, scope: BrowserResetScope): number {
  const keys = browserResetKeys(storage, scope);
  for (const key of keys) storage.removeItem(key);
  return keys.length;
}
