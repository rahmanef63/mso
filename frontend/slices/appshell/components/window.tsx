"use client";

import { memo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useApp } from "../lib/registry";
import { useWindow, useFocused } from "../hooks/use-shell";
import { useWindowDrag } from "../hooks/use-window-drag";
import {
  closeWindow,
  minimizeWindow,
  toggleMaximize,
  focusWindow,
  hasCloseGuard,
  snapRect,
} from "../lib/store";
import { spaceOf, useActiveSpace } from "../lib/spaces";
import { useGroupTop } from "../lib/window-tabs";
import { TrafficLights } from "./traffic-lights";
import { TabStrip } from "./window-tabs";
import { WindowContent } from "./window-content";
import { WinCaption } from "./win-caption";
import { ContextMenu, useContextMenu, type MenuItem } from "./shells/context-menu";
import { togglePin } from "../lib/window-commands";
import { Maximize2, Minimize2, Minus, Pin, PinOff, X } from "lucide-react";
import type { WinId } from "../lib/types";

// Subscribes to ONE window — a drag on another window never re-renders this.
// `variant` picks the title-bar chrome (macOS traffic-lights vs Windows caption
// buttons); the shell that renders the window layer passes it. Everything else
// (drag, 8-way resize, content, snap preview) is shared.
export const Window = memo(function Window({ id, variant = "macos" }: { id: WinId; variant?: "macos" | "windows" }) {
  const win = useWindow(id);
  const app = useApp(win?.app ?? "");
  const focused = useFocused() === id;
  const activeSpace = useActiveSpace();
  const groupTopId = useGroupTop(win?.groupId);
  const ref = useRef<HTMLDivElement>(null);
  const { startDrag, startResize, zone } = useWindowDrag(id, ref);
  const ctx = useContextMenu();
  // Left-button only starts a drag — a right-click on the title bar opens the
  // window menu instead of dragging the frame.
  const onBarDown = (e: React.PointerEvent) => { if (e.button === 0) startDrag(e); };
  // Component-local exit phase: the store close/minimize stay SYNCHRONOUS (tests
  // + bulk ops rely on it); the per-window button animates first, then finalizes
  // the store action on animationend. A guarded window (unsaved editor) skips the
  // animation so its confirm dialog isn't shown over a faded-out frame.
  const [phase, setPhase] = useState<"in" | "closing" | "minimizing">("in");
  const beginClose = () => (hasCloseGuard(id) ? closeWindow(id) : setPhase("closing"));
  const beginMinimize = () => setPhase("minimizing");

  if (!win || win.minimized) return null;
  if (spaceOf(win) !== activeSpace) return null; // lives on another Space
  if (win.groupId && groupTopId !== id) return null; // a tab behind the group's active frame
  const preview = zone ? snapRect(zone) : null;
  const isWin = variant === "windows";
  const title = app && [app.title, ...Object.values(app.shellTitles ?? {})].includes(win.title)
    ? app.shellTitles?.[variant] ?? app.title : win.title;
  // Title-bar right-click menu — the window controls, mirroring the traffic
  // lights / caption buttons plus pin.
  const menuItems: MenuItem[] = [
    { label: win.maximized ? "Restore" : "Maximize", icon: win.maximized ? Minimize2 : Maximize2, onClick: () => toggleMaximize(id) },
    { label: "Minimize", icon: Minus, onClick: beginMinimize, shortcut: isWin ? "Win+↓" : "⌘M" },
    { label: win.pinned ? "Unpin from Top" : "Keep on Top", icon: win.pinned ? PinOff : Pin, onClick: () => togglePin(id) },
    { type: "sep" },
    { label: "Close", icon: X, onClick: beginClose, shortcut: isWin ? "Ctrl+W" : "⌘W" },
  ];
  const anim =
    phase === "closing"
      ? "[animation:winClose_var(--shell-dur-fast)_var(--shell-ease)_forwards]"
      : phase === "minimizing"
        ? "[animation:winMin_var(--shell-dur)_var(--shell-ease)_forwards]"
        : "[animation:winOpen_var(--shell-dur-fast)_var(--shell-ease)]";

  return (
    <>
      {preview && (
        // absolute (not fixed): the preview is a child of the desktop surface, so
        // it shares the same coordinate space as the snapped window — they align.
        <div
          className="absolute z-[5] rounded-xl border-2 border-primary bg-primary/20"
          style={{ left: preview.x, top: preview.y, width: preview.w, height: preview.h }}
        />
      )}
      <div
        ref={ref}
        data-window
        data-app={win.app}
        className={cn(
          "win-geo absolute flex flex-col overflow-hidden border border-border bg-card shadow-[var(--shadow-win)]",
          "rounded-[var(--shell-radius-win)]",
          anim,
          // pinned (always-on-top) windows beat even the focused regular window
          win.pinned ? (focused ? "z-[70]" : "z-[60]") : focused ? "z-50" : "z-10",
        )}
        style={{ left: win.x, top: win.y, width: win.w, height: win.h }}
        onMouseDown={() => focusWindow(id)}
        onAnimationEnd={(e) => {
          // Finalize the deferred store action once the exit animation ends.
          if (e.animationName === "winClose") closeWindow(id);
          else if (e.animationName === "winMin") minimizeWindow(id);
        }}
      >
        {isWin ? (
          <div
            // 32px, not 34: Windows 11's title bar is 32px at 100% scale and its caption
            // buttons are 46x32. win-caption.tsx already sets w-[46px] but inherits the
            // height from here, so a 34px row rendered them 46x34 — two pixels tall
            // everywhere, which is exactly the kind of thing that reads as "not quite
            // Windows" without being nameable.
            className="flex h-8 shrink-0 cursor-grab items-center border-b border-border bg-[var(--mica-win,var(--card))] font-[family-name:var(--shell-font)] active:cursor-grabbing"
            onPointerDown={onBarDown}
            onDoubleClick={() => toggleMaximize(id)}
            onContextMenu={ctx.open}
          >
            <div className="pointer-events-none flex-1 truncate pl-3 text-[12px] font-medium text-muted-foreground">
              {title}
            </div>
            <WinCaption
              id={id}
              maximized={win.maximized}
              onMinimize={beginMinimize}
              onMaximize={() => toggleMaximize(id)}
              onClose={beginClose}
            />
          </div>
        ) : (
          <div
            className="glass flex h-[38px] shrink-0 cursor-grab items-center gap-2 border-b border-border px-3 font-[family-name:var(--shell-font)] active:cursor-grabbing"
            style={{ background: "var(--window-head)" }}
            onPointerDown={onBarDown}
            onDoubleClick={() => toggleMaximize(id)}
            onContextMenu={ctx.open}
          >
            <TrafficLights
              onClose={beginClose}
              onMinimize={beginMinimize}
              onMaximize={() => toggleMaximize(id)}
            />
            <div className="pointer-events-none flex-1 truncate text-center text-[13px] font-semibold text-muted-foreground">
              {title}
            </div>
            <div className="min-w-[54px]" />
          </div>
        )}

        {win.groupId && <TabStrip groupId={win.groupId} activeId={id} />}

        <div className="relative min-h-0 flex-1 overflow-hidden bg-background [container-type:inline-size]">
          <WindowContent app={win.app} payload={win.payload} winId={id} />
        </div>

        <Handle cls="left-0 top-0 h-full w-2 cursor-ew-resize" onDown={(e) => startResize(e, "l")} />
        <Handle cls="right-0 top-0 h-full w-2 cursor-ew-resize" onDown={(e) => startResize(e, "r")} />
        <Handle cls="bottom-0 left-0 h-2 w-full cursor-ns-resize" onDown={(e) => startResize(e, "b")} />
        <Handle cls="bottom-0 right-0 size-4 cursor-nwse-resize" onDown={(e) => startResize(e, "br")} />
      </div>
      <ContextMenu pos={ctx.pos} items={menuItems} onClose={ctx.close} />
    </>
  );
});

function Handle({
  cls,
  onDown,
}: {
  cls: string;
  onDown: (e: React.PointerEvent) => void;
}) {
  return <div className={cn("absolute z-[5]", cls)} onPointerDown={onDown} />;
}
