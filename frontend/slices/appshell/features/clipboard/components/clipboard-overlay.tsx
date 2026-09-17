"use client";

import { useEffect } from "react";
import {
  setClipboardOpen,
  startClipboardCapture,
  toggleClipboard,
  useClipboardOpen,
} from "../../../lib/clipboard";
import { inEditable } from "../../../lib/use-focused-hotkey";

import { DeferredSurface } from "../../../primitives/deferred-surface";
const loadPanel = () => import("./clipboard-panel").then((module) => ({ default: module.ClipboardPanel }));

// ⌘⇧V clipboard history — pinned entries stick, click copies back to the
// system clipboard. Capture (document copy/cut) starts with this feature.
// The panel MOUNTS per open, so the search query starts fresh every time
// without an effect-driven reset (react-hooks v6).
export function ClipboardOverlay() {
  const open = useClipboardOpen();

  useEffect(() => startClipboardCapture(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ⌘⇧V is the canonical terminal/editor paste — don't hijack it while the
      // user is typing; only summon the history panel from outside a field.
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "v" && !inEditable(e.target)) {
        e.preventDefault();
        toggleClipboard();
      } else if (e.key === "Escape") {
        setClipboardOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return <DeferredSurface active={open} load={loadPanel} label="Clipboard history" />;
}
