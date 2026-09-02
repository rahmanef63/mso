"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { registerCommands } from "../../lib/commands";
import { useWindow, useWindowOrder } from "../../hooks/use-shell";
import { useApps } from "../../lib/registry";
import { closeWindow } from "../../lib/store";
import { AppIcon } from "../../components/app-icon";

// The macOS "Force Quit Applications" window: a flat list of open windows, pick
// one and quit it (⌥⌘⎋, palette, or double-click a row). Drives only the store's
// closeWindow — forks no window state, so both desktop shells share it.

// Ephemeral open flag (not persisted) — bridges the palette command / hotkey to
// the mounted dialog, same pattern as the widget picker.
let open = false;
const subs = new Set<() => void>();
function setOpen(v: boolean) {
  open = v;
  subs.forEach((f) => f());
}
function useOpen(): boolean {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    () => open,
    () => false,
  );
}

registerCommands("force-quit", [
  {
    id: "force-quit:open",
    label: "Force Quit…",
    hint: "Window",
    keywords: "kill quit unresponsive apps escape",
    run: () => setOpen(true),
  },
]);

export function ForceQuitDialog() {
  const isOpen = useOpen();
  const order = useWindowOrder();
  const [sel, setSel] = useState<string | null>(null);

  // ⌥⌘⎋ — the macOS Force Quit shortcut. Mounted once (per active shell).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.metaKey && e.key === "Escape") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const quit = (id: string) => {
    closeWindow(id);
    setSel((s) => (s === id ? null : s));
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setSel(null);
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Force Quit Applications</DialogTitle>
        </DialogHeader>
        {order.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No open windows.</p>
        ) : (
          <div className="max-h-72 overflow-auto rounded-lg border border-border">
            {order.map((id) => (
              <ForceQuitRow key={id} id={id} selected={sel === id} onSelect={() => setSel(id)} onQuit={() => quit(id)} />
            ))}
          </div>
        )}
        <div className="flex justify-end">
          <Button type="button" variant="destructive" disabled={!sel} onClick={() => sel && quit(sel)}>
            Force Quit
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ForceQuitRow({
  id,
  selected,
  onSelect,
  onQuit,
}: {
  id: string;
  selected: boolean;
  onSelect: () => void;
  onQuit: () => void;
}) {
  const win = useWindow(id);
  const apps = useApps();
  if (!win) return null;
  const app = apps.find((a) => a.id === win.app);
  return (
    <button
      type="button"
      onClick={onSelect}
      onDoubleClick={onQuit}
      className={cn(
        "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors",
        selected ? "bg-primary text-primary-foreground" : "hover:bg-muted",
      )}
    >
      {app && (
        <span className="size-5 shrink-0">
          <AppIcon app={app} />
        </span>
      )}
      <span className="min-w-0 flex-1 truncate font-medium">{win.title}</span>
      {win.minimized && (
        <span className={cn("text-[10px]", selected ? "text-primary-foreground/70" : "text-muted-foreground")}>minimized</span>
      )}
    </button>
  );
}
