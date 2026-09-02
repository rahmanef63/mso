"use client";

import { useEffect, useMemo } from "react";
import { Keyboard, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  setShortcutHelpOpen,
  useShortcutHelpOpen,
  useShortcuts,
  type ShortcutHint,
} from "../../../lib/shortcuts";

// ⌘/ cheat sheet — every registered shortcut hint, grouped.
export function ShortcutHelpOverlay() {
  const open = useShortcutHelpOpen();
  const hints = useShortcuts();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        setShortcutHelpOpen(!open);
      } else if (e.key === "Escape") {
        setShortcutHelpOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const groups = useMemo(() => {
    const m = new Map<string, ShortcutHint[]>();
    for (const h of hints) {
      const g = h.group ?? "Other";
      m.set(g, [...(m.get(g) ?? []), h]);
    }
    return [...m.entries()];
  }, [hints]);

  if (!open) return null;

  return (
    <div className="absolute inset-0 z-[var(--z-shortcut-help)] flex items-center justify-center bg-black/25" onClick={() => setShortcutHelpOpen(false)}>
      <div className="glass max-h-[75vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-border p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="mb-4 flex items-center gap-2">
          <Keyboard className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Keyboard shortcuts</h2>
          <Button
            type="button" variant="ghost" aria-label="Close"
            onClick={() => setShortcutHelpOpen(false)}
            className="ml-auto h-auto rounded p-1 font-normal hover:bg-muted"
          >
            <X className="size-3.5" />
          </Button>
        </header>
        <div className="grid gap-5 sm:grid-cols-2">
          {groups.map(([group, list]) => (
            <section key={group}>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{group}</h3>
              <ul className="space-y-1.5">
                {list.map((h, i) => (
                  <li key={i} className="flex items-center gap-3 text-[13px]">
                    <kbd className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px]">{h.keys}</kbd>
                    <span className="text-foreground/85">{h.label}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
