"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { setCloseGuard, closeWindow } from "./host";
import { useFocusedHotkey } from "@/features/appshell";

// Owns save-on-shortcut + the dirty-window close guard. `save` and `dirty` are
// read through refs so the global keydown listener and the shell close guard
// each register ONCE yet always act on the current buffer (no stale closures).
export function useCloseGuard(
  winId: string | undefined,
  dirty: boolean,
  save: () => Promise<boolean>,
  saveAll: () => Promise<boolean>,
) {
  const [confirmClose, setConfirmClose] = useState(false);
  // Latest-ref mirrors, written post-render (react-hooks/refs forbids mutating
  // a ref during render) so the once-registered listener + guard stay current.
  const saveRef = useRef(save);
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    saveRef.current = save;
    dirtyRef.current = dirty;
  });

  // Cmd/Ctrl+S saves the active buffer — but ONLY when this code-editor window
  // is the focused one. `allowInEditable: true` because the textarea IS the
  // editor (that's the point); a Save shortcut that stood down inside textareas
  // would never fire here.
  useFocusedHotkey(
    winId,
    [
      { key: "s", meta: true },
      { key: "s", ctrl: true },
    ],
    () => void saveRef.current(),
    { allowInEditable: true },
  );

  // Veto a close while dirty and surface the Save / Don't Save / Cancel prompt.
  useEffect(() => {
    if (!winId) return;
    setCloseGuard(winId, () => {
      if (!dirtyRef.current) return true;
      setConfirmClose(true);
      return false;
    });
    return () => setCloseGuard(winId, null);
  }, [winId]);

  const forceClose = useCallback(() => {
    if (winId) {
      setCloseGuard(winId, null);
      closeWindow(winId);
    }
  }, [winId]);

  const saveThenClose = useCallback(async () => {
    if (await saveAll()) { setConfirmClose(false); forceClose(); }
  }, [forceClose, saveAll]);

  return { confirmClose, setConfirmClose, forceClose, saveThenClose, saveRef };
}
