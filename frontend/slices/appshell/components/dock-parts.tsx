"use client";
/* Dock slot internals — HoverPanel caption/window-list, DockIcon (app slot with
   right-click menu + deep-link <Link>), PlainIcon (launchpad/mission-control).
   Split from dock.tsx so each file stays under the 200-LOC modularity gate.
   BASE is the resting icon size the magnification math in dock.tsx shares. */
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useIntentPrefetch } from "../hooks/use-intent-prefetch";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { openWindow, focusApp, restoreWindow, closeWindow } from "../lib/store";
import { AppIcon } from "./app-icon";
import { useContextMenu, ContextMenu, type MenuItem } from "./shells/context-menu";
import type { AppDescriptor, WindowState } from "../lib/types";

// Resting icon size is a user pref now (dock-prefs). DockIcon/PlainIcon receive it
// as `base`; dock.tsx passes DOCK_SIZE_PX[size].

// Floating panel above an icon (CSS-only; pb-4 bridges the gap so the cursor can
// travel from icon to panel without it closing). `wide` = the running-app menu
// (window list); otherwise a compact macOS name caption centred over the icon.
export function HoverPanel({ wide, children }: { wide?: boolean; children: React.ReactNode }) {
  return (
    <div className="pointer-events-none invisible absolute bottom-full left-1/2 z-[60] -translate-x-1/2 pb-4 opacity-0 transition-all duration-150 group-hover:visible group-hover:opacity-100 group-hover:pointer-events-auto">
      <div
        className={
          "glass rounded-xl border border-border shadow-[0_12px_40px_-8px_rgba(0,0,0,0.55)] " +
          (wide ? "min-w-[180px] p-1" : "whitespace-nowrap px-3 py-1 text-center")
        }
      >
        {children}
      </div>
    </div>
  );
}

// A dock slot: a fixed-height (BASE) layout box that owns the WIDTH (so the bar
// keeps a constant height while it expands sideways), holding an absolute,
// bottom-anchored icon ZONE sized w×w that OVERFLOWS upward — the magnified icon
// rises out of the bar (in front of it) instead of sitting inside. width + height
// transition so hover-in/out (and the redistribution as the cursor moves) glide.
export const SLOT_TRANS = "transition-[width] duration-200 ease-out motion-reduce:transition-none";
export const ZONE_TRANS = "transition-[height] duration-200 ease-out motion-reduce:transition-none";

export function DockIcon({
  app, windows, focused, base, slotRef, zoneRef,
}: {
  app: AppDescriptor;
  windows: WindowState[];
  focused: string | null;
  base: number;
  slotRef: (el: HTMLDivElement | null) => void;
  zoneRef: (el: HTMLDivElement | null) => void;
}) {
  const prefetch = useIntentPrefetch();
  const running = windows.length > 0;
  const href = "/" + (app.slug ?? app.id);
  const hasMenu = windows.length > 0 || !!app.multi;
  const ctx = useContextMenu();

  const activate = () => {
    if (!focusApp(app.id)) openWindow(app.id, app.title, app.defaultSize, undefined, { multi: app.multi });
  };

  // macOS dock right-click menu — running-state aware.
  const ctxItems: MenuItem[] = running
    ? [
        { label: "Show All Windows", onClick: () => windows.forEach((w) => restoreWindow(w.id)) },
        ...(app.multi ? [{ label: "New Window", onClick: () => openWindow(app.id, app.title, app.defaultSize, undefined, { multi: true }) } as MenuItem] : []),
        { type: "sep" as const },
        { label: `Quit ${app.title}`, onClick: () => windows.forEach((w) => closeWindow(w.id)) },
      ]
    : [
        { label: `Open ${app.title}`, onClick: activate },
        ...(app.multi ? [{ label: "New Window", onClick: () => openWindow(app.id, app.title, app.defaultSize, undefined, { multi: true }) } as MenuItem] : []),
      ];

  return (
    <div ref={slotRef} className={cn(`relative shrink-0 ${SLOT_TRANS}`)} style={{ width: base, height: base }}>
      <div ref={zoneRef} className={cn(`group absolute inset-x-0 bottom-0 ${ZONE_TRANS}`)} style={{ height: base }}>
        {hasMenu ? (
          <HoverPanel wide>
            <div className="px-2 py-1 text-center text-[11px] font-semibold text-muted-foreground">{app.title}</div>
            {windows.map((wd, i) => (
              <Button type="button" variant="ghost"
                key={wd.id}
                onClick={() => restoreWindow(wd.id)}
                className={cn("h-auto p-0 font-normal hover:bg-transparent", 
                  "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12px]",
                  wd.id === focused ? "bg-primary/15 text-foreground" : "text-foreground/80 hover:bg-[var(--hover-strong)]",
                )}
              >
                <span className="truncate">{wd.title}</span>
                {windows.length > 1 && <span className="ml-auto text-[10px] text-muted-foreground">{i + 1}</span>}
                {wd.minimized && <span className="text-[10px] text-muted-foreground">hidden</span>}
              </Button>
            ))}
            {app.multi && (
              <Button type="button" variant="ghost"
                onClick={() => openWindow(app.id, app.title, app.defaultSize, undefined, { multi: true })}
                className="h-auto p-0 font-normal hover:bg-transparent flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12px] text-foreground/80 hover:bg-[var(--hover-strong)]"
              >
                <Plus className="size-3.5" /> New Window
              </Button>
            )}
          </HoverPanel>
        ) : (
          <HoverPanel><span className="text-[12.5px] font-medium">{app.title}</span></HoverPanel>
        )}

        <Link
          href={href}
          prefetch={false}
          onPointerEnter={(event) => prefetch.schedule(app, event.pointerType)}
          onPointerLeave={prefetch.cancel}
          onFocus={() => prefetch.schedule(app, "keyboard")}
          onBlur={prefetch.cancel}
          onContextMenu={ctx.open}
          onClick={(e) => {
            if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
              e.preventDefault();
              activate();
            }
          }}
          // The icon is the only child and lucide renders no <title>, so without
          // this the link has NO accessible name — every app in the dock read as
          // a blank link. The HoverPanel that carries app.title is `invisible`,
          // i.e. out of the a11y tree. PlainIcon (below) already did this.
          aria-label={running ? `${app.title} (running)` : app.title}
          className={cn("relative block size-full", !app.iconFill && "drop-shadow-[0_6px_10px_rgba(0,0,0,0.3)]")}
        >
          <AppIcon app={app} />
          {running && (
            <span className="absolute -bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full bg-muted-foreground" />
          )}
        </Link>
      </div>
      <ContextMenu pos={ctx.pos} items={ctxItems} onClose={ctx.close} />
    </div>
  );
}

export function PlainIcon({
  label, onClick, base, slotRef, zoneRef, children,
}: {
  label: string;
  onClick: () => void;
  base: number;
  slotRef: (el: HTMLDivElement | null) => void;
  zoneRef: (el: HTMLDivElement | null) => void;
  children: React.ReactNode;
}) {
  return (
    <div ref={slotRef} className={cn(`relative shrink-0 ${SLOT_TRANS}`)} style={{ width: base, height: base }}>
      <div ref={zoneRef} className={cn(`group absolute inset-x-0 bottom-0 ${ZONE_TRANS}`)} style={{ height: base }}>
        <HoverPanel><span className="text-[12.5px] font-medium">{label}</span></HoverPanel>
        <Button type="button" variant="ghost" onClick={onClick} aria-label={label} className="h-auto p-0 font-normal hover:bg-transparent relative block size-full drop-shadow-[0_6px_10px_rgba(0,0,0,0.3)]">
          {children}
        </Button>
      </div>
    </div>
  );
}

