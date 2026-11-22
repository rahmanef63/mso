export type ClipboardItem = {
  readonly id: string;
  readonly text: string;
  readonly createdAt: number;
};

export type ClipboardStoreOptions = {
  maxItems?: number;
};

export type ClipboardStore = {
  add: (text: string) => string;
  remove: (id: string) => boolean;
  clear: () => void;
  getItems: () => readonly ClipboardItem[];
  subscribe: (listener: (items: readonly ClipboardItem[]) => void) => () => void;
};

export const CLIPBOARD_HARD_MAX = 20;

function clampMaxItems(raw?: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return CLIPBOARD_HARD_MAX;
  return Math.max(1, Math.min(CLIPBOARD_HARD_MAX, Math.floor(raw)));
}

export function filterClipboardItems(
  items: readonly ClipboardItem[],
  query: string,
): readonly ClipboardItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) => item.text.toLowerCase().includes(needle));
}

export function createClipboardStore(options?: ClipboardStoreOptions): ClipboardStore {
  const maxItems = clampMaxItems(options?.maxItems);
  let items: readonly ClipboardItem[] = [];
  let seq = 0;
  const listeners = new Set<(next: readonly ClipboardItem[]) => void>();

  function emit(): void {
    for (const listener of listeners) {
      listener(items);
    }
  }

  function add(text: string): string {
    if (typeof text !== "string" || text.trim().length === 0) {
      return "";
    }
    if (items.length > 0 && items[0].text === text) {
      return items[0].id;
    }
    const id = `c${++seq}`;
    const entry: ClipboardItem = {
      id,
      text,
      createdAt: Date.now(),
    };
    const next = [entry, ...items];
    if (next.length > maxItems) {
      next.length = maxItems;
    }
    items = next;
    emit();
    return id;
  }

  function remove(id: string): boolean {
    const next = items.filter((entry) => entry.id !== id);
    if (next.length === items.length) return false;
    items = next;
    emit();
    return true;
  }

  function clear(): void {
    if (items.length === 0) return;
    items = [];
    emit();
  }

  function getItems(): readonly ClipboardItem[] {
    return items;
  }

  function subscribe(listener: (next: readonly ClipboardItem[]) => void): () => void {
    listeners.add(listener);
    listener(items);
    return () => {
      listeners.delete(listener);
    };
  }

  return { add, remove, clear, getItems, subscribe };
}

let sharedStore: ClipboardStore | null = null;

export function getSharedClipboardStore(): ClipboardStore {
  if (!sharedStore) {
    sharedStore = createClipboardStore();
  }
  return sharedStore;
}
