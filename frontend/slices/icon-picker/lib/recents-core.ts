const KEY = "nosion:iconRecents";
const MAX = 24;

let cache: string[] = [];
let hydrated = false;
let storageBound = false;
const listeners = new Set<() => void>();

function readStorage(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const arr: unknown = JSON.parse(raw);
    return Array.isArray(arr)
      ? arr.filter((v): v is string => typeof v === "string" && v.length > 0).slice(0, MAX)
      : [];
  } catch {
    return [];
  }
}

function persist(values: readonly string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(values));
  } catch {
    // Quota/private-mode failures must not break icon selection.
  }
}

function notify(): void {
  for (const listener of listeners) listener();
}

function ensureHydrated(): void {
  if (hydrated || typeof window === "undefined") return;
  cache = readStorage();
  hydrated = true;
  if (storageBound) return;
  storageBound = true;
  window.addEventListener("storage", (event) => {
    if (event.key !== KEY) return;
    cache = readStorage();
    notify();
  });
}

export function subscribeRecentIcons(listener: () => void): () => void {
  ensureHydrated();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getRecentIconsSnapshot(): readonly string[] {
  ensureHydrated();
  return cache;
}

export function getRecentIconsServerSnapshot(): readonly string[] {
  return [];
}

export function pushRecent(value: string): void {
  if (!value) return;
  ensureHydrated();
  cache = [value, ...cache.filter((item) => item !== value)].slice(0, MAX);
  persist(cache);
  notify();
}

export function clearRecents(): void {
  ensureHydrated();
  cache = [];
  persist(cache);
  notify();
}
