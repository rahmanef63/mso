"use client";

import { useCallback, useState } from "react";
import { useOsApi } from "./host";
import { SEED_FILES } from "./seed";
import { baseName, joinPath } from "./util";

export type SaveState = "idle" | "saved" | "error";

// Owns the editor's working state: the in-memory "disk" (last saved text per
// path), live working buffers, the open-tab list, and the active tab. FS reads
// hydrate a buffer; FS writes are best-effort (live host may be read-only).
export function useEditor() {
  const api = useOsApi();
  const [disk, setDisk] = useState<Record<string, string>>({ ...SEED_FILES });
  const [buffers, setBuffers] = useState<Record<string, string>>({});
  const [tabs, setTabs] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const open = useCallback(
    (path: string) => {
      setTabs((t) => (t.includes(path) ? t : [...t, path]));
      setActive(path);
      setBuffers((b) => {
        if (path in b) return b;
        const seed = disk[path] ?? SEED_FILES[path] ?? "";
        return { ...b, [path]: seed };
      });
      // A SEED path is fictional demo content — `/Projects/counter.tsx` and friends
      // exist only in seed.ts. Asking the host for one always fails, and it did:
      // opening the editor on a live server fired GET /api/v1/fs/read for a path
      // that cannot exist, logging an error on every open. The catch below hid it
      // from the user but not from the console, and a browser e2e caught it.
      // openPath() (a real cross-app "open this file") still always reads.
      if (path in SEED_FILES) return;
      // Best-effort live hydrate; ignore failures (mock / missing file).
      api.fs
        .read(path)
        .then((content) => {
          if (typeof content !== "string" || !content.length) return;
          // The mock adapter's read is a constant placeholder stub — never let it
          // clobber a seeded buffer (it'd replace real seed code, e.g. the live
          // Preview showcase, with "// mock file contents"). Live reads proceed.
          if (api.mode === "mock") return;
          // Adopt the fresh host content as the new disk baseline. Only keep the
          // working buffer if it had UNSAVED edits (buffer !== old disk);
          // otherwise a clean/reopened buffer must follow the file, or it shows
          // stale text and a later Save overwrites the newer host file.
          setBuffers((b) => {
            const hadEdits = path in b && b[path] !== (disk[path] ?? "");
            return hadEdits ? b : { ...b, [path]: content };
          });
          setDisk((d) => ({ ...d, [path]: content }));
        })
        .catch(() => {});
    },
    [api, disk],
  );

  // Payload-driven open (cross-app "open this file"): add a tab, make it
  // active, and explicitly read content. On a live read-only / fetch failure
  // surface the existing read-only status note instead of silently ignoring.
  const openPath = useCallback(
    (path: string) => {
      setTabs((t) => (t.includes(path) ? t : [...t, path]));
      setActive(path);
      setBuffers((b) => (path in b ? b : { ...b, [path]: disk[path] ?? "" }));
      api.fs
        .read(path)
        .then((content) => {
          if (typeof content !== "string") return;
          if (api.mode === "mock") return; // placeholder stub — keep the seed
          // The read may resolve after keystrokes landed in the buffer. Only
          // overwrite the buffer if it's still clean (unchanged vs the disk
          // baseline at read time) or absent; otherwise keep the user's edits
          // and just refresh the disk baseline.
          setBuffers((b) => {
            // A first-open empty buffer has no disk entry yet. It is clean,
            // so adopt the host file; preserve actual keystrokes made while reading.
            const hasEdits = path in b && b[path] !== (disk[path] ?? "");
            return hasEdits ? b : { ...b, [path]: content };
          });
          setDisk((d) => ({ ...d, [path]: content }));
          setSaveState("idle");
        })
        .catch(() => setSaveState("error"));
    },
    [api, disk],
  );

  const close = useCallback(
    (path: string) => {
      setTabs((t) => {
        const i = t.indexOf(path);
        const next = t.filter((x) => x !== path);
        setActive((a) =>
          a === path ? (next[i] ?? next[i - 1] ?? null) : a,
        );
        return next;
      });
    },
    [],
  );

  const edit = useCallback(
    (value: string) => {
      if (active == null) return;
      setBuffers((b) => ({ ...b, [active]: value }));
      setSaveState("idle");
    },
    [active],
  );

  const create = useCallback(
    (dir: string, name: string) => {
      const path = joinPath(dir, name.trim());
      setDisk((d) => ({ ...d, [path]: d[path] ?? "" }));
      open(path);
    },
    [open],
  );

  const save = useCallback(
    async (path = active) => {
      if (path == null) return;
      const value = buffers[path] ?? "";
      const prevDisk = disk[path];
      // Optimistically mark clean, then write. On failure revert the disk
      // baseline so the buffer stays dirty and Save re-enables for a retry.
      setDisk((d) => ({ ...d, [path]: value }));
      try {
        await api.fs.write(path, value);
        setSaveState("saved");
      } catch {
        setDisk((d) => {
          const next = { ...d };
          if (prevDisk === undefined) delete next[path];
          else next[path] = prevDisk;
          return next;
        });
        setSaveState("error");
      }
    },
    [active, api, buffers, disk],
  );

  const value = active != null ? (buffers[active] ?? "") : "";
  const dirty = active != null && buffers[active] !== (disk[active] ?? "");

  return {
    tabs,
    active,
    value,
    dirty,
    saveState,
    buffers,
    disk,
    open,
    openPath,
    close,
    edit,
    create,
    save,
    setActive,
    label: (p: string) => baseName(p),
  };
}
