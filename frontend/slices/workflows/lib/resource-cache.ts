type CacheRow<T> = { value?: T; expiresAt: number; pending?: Promise<T> };
const rows = new Map<string, CacheRow<unknown>>();

export async function cachedWorkflowResource<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now(), current = rows.get(key) as CacheRow<T> | undefined;
  if (current?.value !== undefined && current.expiresAt > now) return structuredClone(current.value);
  if (current?.pending) return structuredClone(await current.pending);
  const pending = load().then((value) => { rows.set(key, { value: structuredClone(value), expiresAt: Date.now() + ttlMs }); return value; }).catch((error) => { rows.delete(key); throw error; });
  rows.set(key, { ...(current?.value !== undefined ? { value: current.value } : {}), expiresAt: current?.expiresAt ?? 0, pending });
  return structuredClone(await pending);
}
export function seedWorkflowResource<T>(key: string, value: T, ttlMs: number) { rows.set(key, { value: structuredClone(value), expiresAt: Date.now() + ttlMs }); }
export function invalidateWorkflowResources(prefix = "") { for (const key of rows.keys()) if (!prefix || key.startsWith(prefix)) rows.delete(key); }
