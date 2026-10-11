"use client";
/* Window Overview — the shared multitasking surface behind macOS Mission Control
   (F3) and the Windows Task View button. A full-surface scrim over a responsive
   grid of every open window: click a card to focus it (and close the overview),
   the × to close that window. Esc dismisses. Drives ONLY the existing store
   actions (focus / restore / close) — it forks no window state, so both desktop
   shells share one implementation. */
import { Button } from "@/components/ui/button";
import { useEffect } from "react";
import { X } from "lucide-react";
import { useWindowOrder, useWindow } from "../../hooks/use-shell";
import { useAppCatalog } from "../../lib/registry";
import { focusWindow, restoreWindow, closeWindow } from "../../lib/store";
import { AppIcon } from "../app-icon";

export function WindowOverview({ onClose, label = "Mission Control" }: { onClose: () => void; label?: string }) {
  const order = useWindowOrder();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const reveal = (id: string) => {
    restoreWindow(id);
    focusWindow(id);
    onClose();
  };

  return (
    <div
      className="absolute inset-0 z-[80] flex flex-col bg-black/55 backdrop-blur-xl animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div className="shrink-0 px-6 pt-5 text-center text-xs font-medium uppercase tracking-widest text-white/70">
        {label}
      </div>
      {order.length === 0 ? (
        <div className="grid flex-1 place-items-center text-sm text-white/60">No open windows</div>
      ) : (
        <div className="grid flex-1 content-start gap-5 overflow-auto p-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {order.map((id) => (
            <OverviewCard key={id} id={id} onReveal={() => reveal(id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function OverviewCard({ id, onReveal }: { id: string; onReveal: () => void }) {
  const win = useWindow(id);
  const apps = useAppCatalog();
  if (!win) return null;
  const app = apps.find((a) => a.id === win.app);
  return (
    <div className="group/card flex flex-col" onClick={(e) => e.stopPropagation()}>
      <Button type="button" variant="ghost"
        onClick={onReveal}
        className="h-auto p-0 font-normal hover:bg-transparent relative aspect-[4/3] overflow-hidden rounded-xl border border-white/15 bg-card text-left shadow-xl ring-0 transition group-hover/card:-translate-y-0.5 group-hover/card:ring-2 group-hover/card:ring-white/70"
      >
        {/* A mini stand-in for the window: app gradient header + icon, since live
            DOM thumbnails aren't captured. Conveys which window without a paint. */}
        <div className="h-7 w-full" style={{ background: app?.gradient ?? "var(--muted)" }} />
        <div className="grid h-[calc(100%-1.75rem)] place-items-center">
          {app && <span className="size-12 opacity-90"><AppIcon app={app} /></span>}
        </div>
        {win.minimized && (
          <span className="absolute bottom-1.5 right-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white/80">
            minimized
          </span>
        )}
      </Button>
      <div className="mt-2 flex items-center gap-1.5 px-1">
        {app && <span className="size-4 shrink-0"><AppIcon app={app} /></span>}
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-white/90">{win.title}</span>
        <Button type="button" variant="ghost"
          onClick={() => closeWindow(id)}
          aria-label="Close window"
          className="h-auto p-0 font-normal hover:bg-transparent grid size-5 shrink-0 place-items-center rounded-full bg-white/10 text-white/70 opacity-0 transition hover:bg-white/25 group-hover/card:opacity-100"
        >
          <X className="size-3" />
        </Button>
      </div>
    </div>
  );
}
