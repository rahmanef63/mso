"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, File as FileIcon, Globe, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ResponsiveDialog } from "../../primitives/responsive-dialog";
import { openWindow } from "../../lib/store";
import { useApps } from "../../lib/registry";
import { AppIcon } from "../../components/app-icon";
import { ContextMenu, useContextMenu, type MenuItem } from "../../components/shells/context-menu";
import {
  ICON_H,
  ICON_W,
  addIcon,
  getDesktopIcons,
  getSelected,
  moveIcons,
  removeIcons,
  setAddDialog,
  setSelected,
  useAddDialog,
  useDesktopIcons,
  useSelected,
  type DesktopIcon,
} from "./store";

// Icons layer — mounted INSIDE the window <section> (behind windows). The
// container is pointer-events-none so the bare desktop keeps its marquee + right-
// click; each icon opts back in and stops propagation so a drag/right-click on an
// icon doesn't also start the desktop marquee / open the desktop menu.
export function DesktopIcons() {
  const icons = useDesktopIcons();
  const selected = useSelected();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && getSelected().size) {
        const t = e.target as HTMLElement | null;
        if (t && /^(INPUT|TEXTAREA)$/.test(t.tagName)) return;
        e.preventDefault();
        removeIcons([...getSelected()]);
        setSelected([]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <>
      <div className="pointer-events-none absolute inset-0 z-[4]">
        {icons.map((icon) => (
          <IconButton key={icon.id} icon={icon} selected={selected.has(icon.id)} />
        ))}
      </div>
      <AddIconDialog />
    </>
  );
}

function IconButton({ icon, selected }: { icon: DesktopIcon; selected: boolean }) {
  const apps = useApps();
  const menu = useContextMenu();
  const drag = useRef<{ x: number; y: number } | null>(null);
  const app = icon.kind === "app" ? apps.find((a) => a.id === icon.app) : undefined;
  if (icon.kind === "app" && !app) return null;
  const label = icon.kind === "app" ? app?.title ?? "" : icon.label;
  const open = () => {
    if (icon.kind === "app" && app) openWindow(app.id, app.title, app.defaultSize);
    else if (icon.kind === "link") window.open(icon.url, "_blank", "noopener,noreferrer");
    else if (icon.kind === "file") openWindow("files-manager", label || "Files", undefined, { path: icon.path }, { multi: true });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (!getSelected().has(icon.id)) setSelected([icon.id]);
    drag.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    drag.current = { x: e.clientX, y: e.clientY };
    const ids = getSelected().has(icon.id) ? [...getSelected()] : [icon.id];
    moveIcons({ dx, dy }, ids);
  };
  const onPointerUp = () => { drag.current = null; };

  const items: MenuItem[] = [
    { label: "Open", icon: ExternalLink, onClick: open },
    { type: "sep" },
    { label: "Remove", icon: Trash2, onClick: () => removeIcons([icon.id]), danger: true },
  ];

  return (
    <>
      <button
        type="button"
        style={{ left: icon.x, top: icon.y, width: ICON_W }}
        className={cn(
          "pointer-events-auto absolute flex touch-none flex-col items-center gap-1 rounded-lg p-1.5 text-center",
          selected ? "bg-primary/25 ring-1 ring-primary/60" : "hover:bg-white/10",
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={open}
        onContextMenu={(e) => {
          e.stopPropagation();
          if (!getSelected().has(icon.id)) setSelected([icon.id]);
          menu.open(e);
        }}
      >
        <span className="grid size-11 place-items-center drop-shadow">
          {icon.kind === "app" && app ? (
            <AppIcon app={app} />
          ) : (
            <span className="grid size-10 place-items-center rounded-xl bg-primary/80 text-primary-foreground">
              {icon.kind === "link" ? <Globe className="size-6" /> : <FileIcon className="size-6" />}
            </span>
          )}
        </span>
        <span className="line-clamp-2 w-full text-[11px] font-medium text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]">
          {label}
        </span>
      </button>
      <ContextMenu pos={menu.pos} items={items} onClose={menu.close} />
    </>
  );
}

// Add a link or file icon — a small dialog opened from the desktop right-click
// menu ("Add link…" / "Add file…"). A bare URL gets an https:// prefix. Resets on
// close (no effect) so the next open starts blank.
function AddIconDialog() {
  const kind = useAddDialog();
  const [val, setVal] = useState("");
  const [label, setLabel] = useState("");
  const close = () => {
    setVal("");
    setLabel("");
    setAddDialog(null);
  };
  const submit = () => {
    const v = val.trim();
    if (!v) return;
    if (kind === "link") {
      addIcon({ kind: "link", url: /^https?:\/\//i.test(v) ? v : `https://${v}`, label: label.trim() || v });
    } else if (kind === "file") {
      addIcon({ kind: "file", path: v, label: label.trim() || v.split("/").filter(Boolean).pop() || v });
    }
    close();
  };
  return (
    <ResponsiveDialog open={!!kind} onOpenChange={(o) => !o && close()} size="sm">
      <ResponsiveDialog.Header>
        <ResponsiveDialog.Title>{kind === "link" ? "Add link" : "Add file"}</ResponsiveDialog.Title>
      </ResponsiveDialog.Header>
      <ResponsiveDialog.Body className="space-y-3">
        <Input
          autoFocus
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder={kind === "link" ? "https://example.com" : "/home/rahman/projects"}
        />
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Label (optional)"
        />
      </ResponsiveDialog.Body>
      <ResponsiveDialog.Footer>
        <Button type="button" variant="outline" onClick={close}>Cancel</Button>
        <Button type="button" onClick={submit} disabled={!val.trim()}>Add</Button>
      </ResponsiveDialog.Footer>
    </ResponsiveDialog>
  );
}

// Rubber-band selection for the desktop section. `onPointerDown` goes on the
// section (fires only on the bare surface, left button); it draws a rect (in
// section-relative coords) and live-selects the icons it intersects. Returns the
// rect for the caller to render as an overlay.
export function useDesktopMarquee() {
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const origin = useRef<{ cx: number; cy: number; ox: number; oy: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    origin.current = { cx: e.clientX, cy: e.clientY, ox: box.left, oy: box.top };
    setSelected([]);
    const move = (ev: PointerEvent) => {
      const o = origin.current;
      if (!o) return;
      const x0 = Math.min(o.cx, ev.clientX) - o.ox;
      const y0 = Math.min(o.cy, ev.clientY) - o.oy;
      const x1 = Math.max(o.cx, ev.clientX) - o.ox;
      const y1 = Math.max(o.cy, ev.clientY) - o.oy;
      setRect({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      setSelected(
        getDesktopIcons()
          .filter((i) => i.x < x1 && i.x + ICON_W > x0 && i.y < y1 && i.y + ICON_H > y0)
          .map((i) => i.id),
      );
    };
    const up = () => {
      origin.current = null;
      setRect(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return { onPointerDown, rect };
}
