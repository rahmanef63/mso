export const LAZY_MODAL_KEYS = [
  "palette",
  "control",
  "forceQuit",
  "shortcuts",
  "lock",
] as const;

export type LazyModalKey = (typeof LAZY_MODAL_KEYS)[number];

export type ModalLoader<T> = () => Promise<T>;

export type ModalLoaderCache<T> = {
  load: (key: LazyModalKey, loader: ModalLoader<T>) => Promise<T>;
  getResolved: (key: LazyModalKey) => T | undefined;
  has: (key: LazyModalKey) => boolean;
  clear: (key?: LazyModalKey) => void;
};

export function createModalLoaderCache<T = unknown>(): ModalLoaderCache<T> {
  const pending = new Map<LazyModalKey, Promise<T>>();
  const resolved = new Map<LazyModalKey, T>();

  function load(key: LazyModalKey, loader: ModalLoader<T>): Promise<T> {
    const existing = pending.get(key);
    if (existing) return existing;

    let raw: Promise<T>;
    try {
      raw = Promise.resolve(loader());
    } catch (error) {
      return Promise.reject(error);
    }

    const tracked = raw.then(
      (value) => {
        if (pending.get(key) === tracked) {
          resolved.set(key, value);
        }
        return value;
      },
      (error) => {
        if (pending.get(key) === tracked) {
          pending.delete(key);
          resolved.delete(key);
        }
        throw error;
      },
    );

    pending.set(key, tracked);
    return tracked;
  }

  function getResolved(key: LazyModalKey): T | undefined {
    return resolved.get(key);
  }

  function has(key: LazyModalKey): boolean {
    return pending.has(key);
  }

  function clear(key?: LazyModalKey): void {
    if (key === undefined) {
      pending.clear();
      resolved.clear();
      return;
    }
    pending.delete(key);
    resolved.delete(key);
  }

  return { load, getResolved, has, clear };
}
