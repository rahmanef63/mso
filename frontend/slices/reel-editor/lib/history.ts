// Undo/redo history hook over an immutable Composition state.
// Coalesces rapid edits (e.g. slider drags) into a single undo step.

"use client";

import { useCallback, useRef, useState } from "react";
import { type Composition, defaultComposition } from "./mock-timeline";
import { readDraft } from "./draft";

const LIMIT = 60;
const COALESCE_MS = 400;

export type HistoryApi = {
  comp: Composition;
  draftBaseline: { snapshot: string | null; available: boolean };
  /** Apply a transform. Pass `commit:true` to force a fresh undo step. */
  apply: (fn: (c: Composition) => Composition, commit?: boolean) => void;
  /** Force the next `apply` to start a new undo step. */
  commit: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
};

export function useHistory(): HistoryApi {
  // Resume the auto-saved draft when one exists (client-only component).
  const [initial] = useState(readDraft);
  const [comp, setComp] = useState<Composition>(() => initial.comp ?? defaultComposition());
  const [past, setPast] = useState<Composition[]>([]);
  const [future, setFuture] = useState<Composition[]>([]);
  const lastPush = useRef(0);

  const commit = useCallback(() => {
    lastPush.current = 0;
  }, []);

  const apply = useCallback(
    (fn: (c: Composition) => Composition, force?: boolean) => {
      setComp((prev) => {
        const next = fn(prev);
        if (next === prev) return prev;
        const now = Date.now();
        if (force || now - lastPush.current > COALESCE_MS) {
          setPast((p) => [...p.slice(-(LIMIT - 1)), prev]);
          setFuture([]);
        }
        lastPush.current = now;
        return next;
      });
    },
    [],
  );

  const undo = useCallback(() => {
    setPast((p) => {
      if (!p.length) return p;
      setFuture((f) => [comp, ...f].slice(0, LIMIT));
      setComp(p[p.length - 1]);
      lastPush.current = Date.now();
      return p.slice(0, -1);
    });
  }, [comp]);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (!f.length) return f;
      setPast((p) => [...p, comp].slice(-LIMIT));
      setComp(f[0]);
      lastPush.current = Date.now();
      return f.slice(1);
    });
  }, [comp]);

  return { comp, draftBaseline: initial, apply, commit, undo, redo, canUndo: past.length > 0, canRedo: future.length > 0 };
}
