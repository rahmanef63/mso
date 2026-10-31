"use client";

import { useEffect } from "react";
import { setShortcutHelpOpen, useShortcutHelpOpen } from "../../lib/shortcuts";
import { DeferredSurface } from "../../primitives/deferred-surface";

const load = () => import("./components/shortcut-help-overlay").then((module) => ({ default: module.ShortcutHelpOverlay }));

export function DeferredShortcutHelp() {
  const open = useShortcutHelpOpen();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        setShortcutHelpOpen(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return <DeferredSurface active={open} load={load} label="Keyboard shortcuts" />;
}
