"use client";

import { createElement, useEffect, useRef, useState, type CSSProperties } from "react";
import { Check, LayoutGrid, Trash2 } from "lucide-react";
import { ContextMenu, useContextMenu } from "../../../components/shells/context-menu";
import { registerCommands } from "../../../lib/commands";
import { registerContextMenu, type MenuItem } from "../../../lib/context-menu";
import { toast } from "../../../lib/toast";
import { cn } from "@/lib/utils";
import {
  getWidgetState,
  setPickerOpen,
  setWidgetPos,
  setWidgetSize,
  setWidgetsOn,
  toggleWidget,
  useWidgetState,
  type WidgetPos,
  type WidgetSize,
} from "../widget-registry";
import { WIDGET_RENDER } from "./widgets-defs";
import { WidgetPicker } from "./widget-picker";

// Desktop widgets — a glanceable, EDITABLE set free-positioned on the wallpaper
// layer (behind windows). Drag a widget to move it; right-click sets its size or
// removes it. Layout + membership live in the widget-registry store; the
// WidgetPicker (live-preview gallery) edits membership.

registerCommands("desktop-widgets", [
  {
    id: "widgets:desktop",
    label: "Toggle desktop widgets",
    hint: "Widgets",
    keywords: "glance dashboard wallpaper stats",
    run: () => {
      const next = !getWidgetState().on;
      setWidgetsOn(next);
      toast(next ? "Desktop widgets on" : "Desktop widgets off");
    },
  },
  {
    id: "widgets:configure",
    label: "Configure desktop widgets",
    hint: "Widgets",
    keywords: "desktop widget picker add remove reorder",
    run: () => setPickerOpen(true),
  },
]);

registerContextMenu("macos", () => [
  { label: "Desktop widgets…", icon: LayoutGrid, onClick: () => setPickerOpen(true) },
]);

const SIZE_W: Record<WidgetSize, string> = { s: "w-44", m: "w-60", l: "w-72" };
const SIZE_PX: Record<WidgetSize, number> = { s: 176, m: 240, l: 288 };

// One free-dragged widget. Drag from any non-interactive part (its own inputs /
// buttons keep working); the move commits once on drop (not every frame). Right-
// click sets its size or removes it.
function DesktopWidget({ id, size, pos }: { id: string; size: WidgetSize; pos: WidgetPos }) {
  const ctx = useContextMenu();
  const Render = WIDGET_RENDER[id];
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [offset, setOffset] = useState<{ dx: number; dy: number } | null>(null);
  if (!Render) return null;

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("input,textarea,button,a,[contenteditable],iframe,summary")) return;
    e.stopPropagation();
    drag.current = { x: e.clientX, y: e.clientY };
    setOffset({ dx: 0, dy: 0 });
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setOffset({ dx: e.clientX - drag.current.x, dy: e.clientY - drag.current.y });
  };
  const onPointerUp = () => {
    if (drag.current && offset) setWidgetPos(id, pos.x + offset.dx, pos.y + offset.dy);
    drag.current = null;
    setOffset(null);
  };

  const items: MenuItem[] = [
    { label: "Small", icon: size === "s" ? Check : undefined, onClick: () => setWidgetSize(id, "s") },
    { label: "Medium", icon: size === "m" ? Check : undefined, onClick: () => setWidgetSize(id, "m") },
    { label: "Large", icon: size === "l" ? Check : undefined, onClick: () => setWidgetSize(id, "l") },
    { type: "sep" },
    { label: "Remove widget", icon: Trash2, onClick: () => toggleWidget(id), danger: true },
    { label: "Desktop widgets…", icon: LayoutGrid, onClick: () => setPickerOpen(true) },
  ];

  return (
    <div
      className={cn(
        // Elevation so a widget reads as the same floating surface family as
        // windows (which carry --shadow-win). filter drop-shadow — not box-shadow
        // — follows the inner card's rounded alpha; this square wrapper has no radius.
        "pointer-events-auto absolute touch-none cursor-grab active:cursor-grabbing drop-shadow-[0_8px_24px_rgba(0,0,0,0.28)]",
        SIZE_W[size],
      )}
      style={{ left: pos.x + (offset?.dx ?? 0), top: pos.y + (offset?.dy ?? 0) }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onContextMenu={(e) => { e.stopPropagation(); ctx.open(e); }}
    >
      {createElement(Render)}
      <ContextMenu pos={ctx.pos} items={items} onClose={ctx.close} />
    </div>
  );
}

export function DesktopWidgets() {
  const { on, enabled, sizes, positions } = useWidgetState();
  const ref = useRef<HTMLDivElement>(null);

  // Auto-place any enabled widget that lacks a saved position — a top-right
  // column, matching the previous stack so the migration is seamless.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const W = el.clientWidth;
    let slot = 0;
    for (const id of enabled) {
      if (positions[id]) continue;
      setWidgetPos(id, Math.max(0, W - SIZE_PX[sizes[id] ?? "m"] - 16), 16 + slot * 128);
      slot++;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled.join(","), on]);

  if (!on) return <WidgetPicker />;
  return (
    <>
      <WidgetPicker />
      <div
        ref={ref}
        className="pointer-events-none absolute inset-0 z-[5]"
        // Desktop-only: point the shared widget Card's radius at the WINDOW token
        // so widgets read as the same floating surface family as windows. Mobile
        // Today never sets this var → its Cards keep the 1rem fallback → intact.
        style={{ "--widget-radius": "var(--shell-radius-win)" } as CSSProperties}
      >
        {enabled.map((id) => {
          const pos = positions[id];
          return pos ? <DesktopWidget key={id} id={id} size={sizes[id] ?? "m"} pos={pos} /> : null;
        })}
      </div>
    </>
  );
}
