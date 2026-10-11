"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePrefsSync } from "@/lib/prefs/use-prefs-sync";

// User-curated website shortcuts (Settings → Quicklink). Each is just a URL +
// label; the favicon is derived from the URL. Persisted to localStorage like the
// appearance tweaks — public config only, no secrets. Surfaced in the dock,
// Launchpad, mobile grid, a Today widget and the Quicklinks window; opening one
// pops a new native browser tab.
export type Quicklink = { id: string; title: string; url: string };

const KEY = "mso:quicklinks";

// Fresh menus contain only essential apps; cached and server shortcuts restore as before.
const DEFAULTS: Quicklink[] = [];

type Ctx = {
  items: Quicklink[];
  add: (url: string, title?: string) => void;
  update: (id: string, patch: Partial<Omit<Quicklink, "id">>) => void;
  remove: (id: string) => void;
  move: (id: string, dir: -1 | 1) => void;
};

const QuicklinksContext = createContext<Ctx | null>(null);

function newId(): string {
  return crypto.randomUUID().slice(0, 8);
}

/** Drop anything that isn't a `{ id, title, url }` row of strings — one bad
 *  row from a stale cache or the server would otherwise crash every consumer
 *  (dock, Launchpad, widget, Settings). */
export function sanitizeQuicklinks(raw: unknown): Quicklink[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (x): x is Quicklink =>
      !!x &&
      typeof x === "object" &&
      typeof (x as Quicklink).id === "string" &&
      typeof (x as Quicklink).title === "string" &&
      typeof (x as Quicklink).url === "string",
  );
}

/** Bare host/path → https URL; leaves an existing scheme untouched. */
export function normalizeUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

/** Friendly default label from the host when none is given. */
export function titleFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Google s2 favicon for a URL (covered by next.config images.remotePatterns). */
export function faviconUrl(url: string): string | null {
  if (!/^https?:\/\//i.test(url)) return null;
  return `https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(url)}`;
}

export function QuicklinksProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Quicklink[]>(DEFAULTS);

  // Hydrate after mount (server render uses DEFAULTS → no hydration mismatch).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot post-hydration restore from localStorage (a lazy initializer would read storage on the server and hydration-mismatch)
      if (raw) setItems(sanitizeQuicklinks(JSON.parse(raw)));
    } catch {
      /* malformed cache — keep defaults */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(items));
    } catch {
      /* quota / private mode */
    }
  }, [items]);

  // Cross-device sync (lib/prefs): server list wins on initial load, local edits
  // debounce back up. No-op in demo / before login (silent 401 → retry on auth).
  const applyServer = useCallback((xs: Quicklink[]) => {
    if (Array.isArray(xs)) setItems(sanitizeQuicklinks(xs));
  }, []);
  usePrefsSync({ section: "quicklinks", value: items, apply: applyServer });

  const add = useCallback((url: string, title?: string) => {
    const u = normalizeUrl(url);
    if (!u) return;
    setItems((xs) => [...xs, { id: newId(), url: u, title: title?.trim() || titleFromUrl(u) }]);
  }, []);

  // Raw patch (no URL normalization) so inline editing doesn't fight the caret;
  // callers normalize the URL on commit (onBlur) via normalizeUrl().
  const update = useCallback((id: string, patch: Partial<Omit<Quicklink, "id">>) => {
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }, []);

  const remove = useCallback((id: string) => {
    setItems((xs) => xs.filter((x) => x.id !== id));
  }, []);

  const move = useCallback((id: string, dir: -1 | 1) => {
    setItems((xs) => {
      const i = xs.findIndex((x) => x.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= xs.length) return xs;
      const copy = [...xs];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  }, []);

  // Memoized ctx (callbacks are stable) — consumers only re-render on items.
  const ctx = useMemo(() => ({ items, add, update, remove, move }), [items, add, update, remove, move]);
  return <QuicklinksContext.Provider value={ctx}>{children}</QuicklinksContext.Provider>;
}

export function useQuicklinks(): Ctx {
  const c = useContext(QuicklinksContext);
  if (!c) throw new Error("useQuicklinks must be used within QuicklinksProvider");
  return c;
}

/** Open a quicklink in a new native browser tab (rel=noopener). */
export function openQuicklink(ql: Quicklink): void {
  if (typeof window !== "undefined") window.open(ql.url, "_blank", "noopener,noreferrer");
}
