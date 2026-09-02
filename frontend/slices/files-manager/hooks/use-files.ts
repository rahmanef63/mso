"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/features/appshell";
import { useOsApi, type FsEntry, type FsRoot, type FsUsage } from "../lib/host";
import type { Clipboard } from "../lib/types";
import { useFileOps } from "./use-file-ops";
import { usePathHistory } from "./use-path-history";

export { TRASH_PATH } from "./use-file-ops";

// Map raw fs errors to something actionable (never mask the real cause — a
// blanket "read-only" hid genuine failures like body-size limits).
const friendly = (msg: string) =>
  msg.includes("writable roots")
    ? "Folder is outside the writable area (OS_FS_WRITE_ROOTS)"
    : msg;

// All filesystem state + mutations for the manager. Every mutation runs through
// `guard`, which surfaces a one-line inline error instead of throwing, then
// reloads the current dir on success. Navigation history lives in
// `usePathHistory`; the mutations themselves in `useFileOps`.
export function useFiles(initialPath?: string) {
  const api = useOsApi();
  const nav = usePathHistory(initialPath || "~");
  const { path } = nav;
  // Listing keyed by the request that produced it: when path/reload move on the
  // stale result stops matching and `entries` derives back to null (loading) —
  // no synchronous setState reset in the effect (react-hooks/set-state-in-effect).
  const [listing, setListing] = useState<{ key: string; entries: FsEntry[] } | null>(null);
  // Keyed like `listing`: a failed list for the CURRENT request → show a Retry
  // state instead of an empty folder. Stale errors derive away on path/reload.
  const [listError, setListError] = useState<{ key: string } | null>(null);
  const [roots, setRoots] = useState<FsRoot[]>([]);
  const [usage, setUsage] = useState<FsUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clip, setClip] = useState<Clipboard | null>(null);
  const [reload, setReload] = useState(0);

  const refresh = useCallback(() => setReload((n) => n + 1), []);

  const loadKey = `${path} ${reload}`;
  const entries = listing?.key === loadKey ? listing.entries : null;
  const loadFailed = listError?.key === loadKey;
  // Remember the last key we toasted for so a single failure fires once
  // (not on every re-render while the error state sticks around).
  const toastedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.fs
      .list(path)
      .then((res) => {
        if (!alive) return;
        setListing({ key: loadKey, entries: res.entries });
        if (res.roots?.length) setRoots(res.roots);
      })
      .catch((e) => {
        // Don't fake an empty folder (its "drop to upload" invite is misleading)
        // — flag the failed request so the view offers a Retry instead.
        if (!alive) return;
        setListError({ key: loadKey });
        if (toastedKeyRef.current !== loadKey) {
          toastedKeyRef.current = loadKey;
          const msg = e instanceof Error ? e.message : String(e);
          toast(`Couldn't load ${path}: ${friendly(msg)}`, {
            tone: "error",
            appId: "files-manager",
          });
        }
      });
    return () => {
      alive = false;
    };
  }, [api, path, loadKey]);

  useEffect(() => {
    let alive = true;
    api.fs.usage().then((u) => alive && setUsage(u)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [api, reload]);

  const guard = useCallback(
    async (run: () => Promise<unknown>) => {
      setError(null);
      try {
        await run();
        setReload((n) => n + 1);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(friendly(msg));
      }
    },
    [],
  );

  const taken = useMemo(
    () => new Set((entries ?? []).map((e) => e.name)),
    [entries],
  );

  const ops = useFileOps({ api, guard, path, taken, clip, setClip });

  return {
    api,
    path,
    entries,
    loadFailed,
    roots,
    usage,
    error,
    clip,
    canBack: nav.canBack,
    canForward: nav.canForward,
    setError,
    setClip,
    navigate: nav.navigate,
    goBack: nav.goBack,
    goForward: nav.goForward,
    refresh,
    ...ops,
  };
}

export type UseFiles = ReturnType<typeof useFiles>;
