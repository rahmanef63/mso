// Exact-window ephemeral feature state store (mirrors FRONTEND-CONTRACT useFeatureState).
// Survives shell remounts (macOS <-> Windows <-> iOS <-> Android <-> Dashboard)
// and clears cleanly on window close or sign-out.

const store = new Map<string, Map<string, unknown>>();

export function getWinState<T>(winId: string | undefined, key: string, fallback: T): T {
  if (!winId) return fallback;
  const bucket = store.get(winId);
  if (!bucket || !bucket.has(key)) return fallback;
  return bucket.get(key) as T;
}

export function setWinState<T>(winId: string | undefined, key: string, value: T): void {
  if (!winId) return;
  let bucket = store.get(winId);
  if (!bucket) {
    bucket = new Map<string, unknown>();
    store.set(winId, bucket);
  }
  bucket.set(key, value);
}

export function deleteWinStateKey(winId: string | undefined, key: string): void {
  if (!winId) return;
  store.get(winId)?.delete(key);
}

export function clearWinState(winId: string): void {
  store.delete(winId);
}

export function clearAllWinState(): void {
  store.clear();
}
