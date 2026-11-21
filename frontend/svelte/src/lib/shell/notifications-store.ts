export type NotificationTone = "info" | "ok" | "warn" | "error";

export type NotificationInput = {
  title: string;
  detail?: string;
  tone?: NotificationTone;
  ttlMs?: number;
};

export type NotificationItem = {
  readonly id: string;
  readonly title: string;
  readonly detail?: string;
  readonly tone: NotificationTone;
  readonly createdAt: number;
  readonly ttlMs: number;
};

export type NotificationStoreOptions = {
  maxItems?: number;
  defaultTtlMs?: number;
};

export type NotificationStore = {
  push: (input: NotificationInput) => string;
  dismiss: (id: string) => boolean;
  clear: () => void;
  subscribe: (listener: (items: readonly NotificationItem[]) => void) => () => void;
  getItems: () => readonly NotificationItem[];
  dispose: () => void;
};

const HARD_MAX_ITEMS = 5;
const DEFAULT_TTL_MS = 5000;

function clampMaxItems(raw?: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return HARD_MAX_ITEMS;
  return Math.max(1, Math.min(HARD_MAX_ITEMS, Math.floor(raw)));
}

function normalizeTtl(raw: number | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.floor(raw);
}

export function createNotificationStore(options?: NotificationStoreOptions): NotificationStore {
  const maxItems = clampMaxItems(options?.maxItems);
  const defaultTtlMs = normalizeTtl(options?.defaultTtlMs, DEFAULT_TTL_MS);

  let items: readonly NotificationItem[] = [];
  let seq = 0;
  let disposed = false;

  const listeners = new Set<(next: readonly NotificationItem[]) => void>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  function emit(): void {
    for (const listener of listeners) {
      listener(items);
    }
  }

  function clearTimer(id: string): void {
    const handle = timers.get(id);
    if (handle !== undefined) {
      clearTimeout(handle);
      timers.delete(id);
    }
  }

  function clearAllTimers(): void {
    for (const handle of timers.values()) {
      clearTimeout(handle);
    }
    timers.clear();
  }

  function dismiss(id: string): boolean {
    if (disposed) return false;
    clearTimer(id);
    const next = items.filter((entry) => entry.id !== id);
    if (next.length === items.length) return false;
    items = next;
    emit();
    return true;
  }

  function push(input: NotificationInput): string {
    if (disposed) return "";
    const id = `n${++seq}`;
    const ttlMs = normalizeTtl(input.ttlMs, defaultTtlMs);
    const title = input.title.trim() || "Notification";
    const detail = input.detail?.trim();
    const item: NotificationItem = {
      id,
      title,
      ...(detail ? { detail } : {}),
      tone: input.tone ?? "info",
      createdAt: Date.now(),
      ttlMs,
    };

    const next = [...items, item];
    while (next.length > maxItems) {
      const evicted = next.shift();
      if (evicted) clearTimer(evicted.id);
    }
    items = next;

    if (ttlMs > 0) {
      const handle = setTimeout(() => {
        timers.delete(id);
        dismiss(id);
      }, ttlMs);
      timers.set(id, handle);
    }

    emit();
    return id;
  }

  function clear(): void {
    clearAllTimers();
    if (items.length === 0) return;
    items = [];
    if (!disposed) emit();
  }

  function subscribe(listener: (next: readonly NotificationItem[]) => void): () => void {
    if (disposed) {
      listener([]);
      return () => {};
    }
    listeners.add(listener);
    listener(items);
    return () => {
      listeners.delete(listener);
    };
  }

  function getItems(): readonly NotificationItem[] {
    return items;
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    clearAllTimers();
    items = [];
    listeners.clear();
  }

  return { push, dismiss, clear, subscribe, getItems, dispose };
}
