"use client";
/* ContextMenu — a tiny right-click menu shared by every shell (desktop
   background, taskbar/dock buttons). Open it from an onContextMenu handler via
   useContextMenu() (static items, e.g. a dock icon) or useShellContextMenu()
   (the desktop background — merges the shell's built-ins with registry items).
   It positions at the cursor, closes on outside-click / Esc / scroll / Tab, clamps
   to the viewport on all four edges, and follows the WAI-ARIA APG menu pattern
   (first item focused on open, Arrow/Home/End, Esc unwinds one level, focus
   restored to the trigger on close). Portaled to document.body so its z-index
   always wins — a non-portaled fixed layer is trapped inside a positioned ancestor.
   ONE level of submenu is supported ({ type: "submenu", items }): its panel is a
   SIBLING inside the same portal, never a child — the root panel is
   `overflow-y-auto`, so a nested panel would be clipped and scroll-bound by it. */
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getContextMenuItems, joinGroups, submenuPos, type MenuItem } from "../../lib/context-menu";
import type { ShellId, ShellSurface } from "../../registry/shells";
import { useActiveShell } from "../../registry/shells";
import { MenuRows, PANEL, SubPanel, menuMetrics } from "./context-menu-parts";

export type { MenuItem };

type Pos = { x: number; y: number } | null;
type ClickLike = { preventDefault: () => void; clientX: number; clientY: number };
type SubState = { i: number; row: { top: number; left: number; right: number }; kbd: boolean } | null;

const btns = (scope: HTMLElement | null) =>
  Array.from(scope?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? []);

export function useContextMenu() {
  const [pos, setPos] = useState<Pos>(null);
  const open = useCallback((e: ClickLike) => {
    e.preventDefault();
    setPos({ x: e.clientX, y: e.clientY });
  }, []);
  const close = useCallback(() => setPos(null), []);
  return { pos, open, close };
}

// Desktop-background menu: merges the shell's own built-in items (passed at open
// time, so they read current state) with everything registered for this shell.
export function useShellContextMenu(shell: ShellId, surface: ShellSurface = "desktop") {
  const [state, setState] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const open = useCallback(
    (e: ClickLike, base: MenuItem[] = []) => {
      // Build items BEFORE preventDefault: if the merged menu is empty, leave the
      // browser's native menu intact rather than suppressing it AND showing nothing.
      const dynamic = getContextMenuItems({ shell, surface, x: e.clientX, y: e.clientY });
      const items = joinGroups([base, dynamic]);
      if (!items.length) return;
      e.preventDefault();
      setState({ x: e.clientX, y: e.clientY, items });
    },
    [shell, surface],
  );
  const close = useCallback(() => setState(null), []);
  return { state, open, close };
}

// Renders the merged menu from useShellContextMenu state.
export function ShellContextMenu({
  state,
  onClose,
}: {
  state: { x: number; y: number; items: MenuItem[] } | null;
  onClose: () => void;
}) {
  return <ContextMenu pos={state ? { x: state.x, y: state.y } : null} items={state?.items ?? []} onClose={onClose} />;
}

export function ContextMenu({ pos, items, onClose }: { pos: Pos; items: MenuItem[]; onClose: () => void }) {
  const menuRef = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const subIdx = useRef<number | null>(null); // mirrors `sub` for the stable key handler
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sub, setSub] = useState<SubState>(null);
  const [subSize, setSubSize] = useState<{ w: number; h: number } | null>(null);
  const active = useActiveShell(); // reactive shell id — beats DOM-sniffing [data-shell]

  const cancelClose = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const closeSub = useCallback(
    (refocus = false) => {
      cancelClose();
      const i = subIdx.current;
      subIdx.current = null;
      setSub(null);
      if (refocus && i !== null) menuRef.current?.querySelector<HTMLButtonElement>(`[data-sub="${i}"]`)?.focus();
    },
    [cancelClose],
  );
  const openSub = useCallback(
    (i: number, rect: DOMRect, opts: { toggle?: boolean; kbd?: boolean } = {}) => {
      cancelClose();
      if (subIdx.current === i && !opts.kbd) return opts.toggle ? closeSub() : undefined; // tap toggles
      if (subIdx.current !== i) setSubSize(null); // re-measure the new panel
      subIdx.current = i;
      setSub({ i, row: { top: rect.top, left: rect.left, right: rect.right }, kbd: !!opts.kbd });
    },
    [cancelClose, closeSub],
  );
  // Hover-away is delayed so a diagonal trip from the row into the panel doesn't
  // dismiss it mid-flight (the panel's own mouseenter cancels the timer).
  const leaveSub = useCallback(() => {
    cancelClose();
    timer.current = setTimeout(() => closeSub(), 180);
  }, [cancelClose, closeSub]);

  // TWO effects on purpose. This one owns the DESTRUCTIVE open/close lifecycle —
  // its cleanup closes the submenu and yanks focus back to the trigger — so its
  // deps are the PRIMITIVE coords plus stable callbacks ONLY. Never the `pos`
  // object (callers rebuild it every render) and never `onClose` (ContextMenuHost
  // wraps the whole desktop, so a prop identity change means every window-store
  // patch would tear an open submenu down mid-keyboard-nav). Anything that can
  // change per render belongs in the inert listener effect below, not here.
  const px = pos?.x, py = pos?.y;
  useEffect(() => {
    if (px === undefined || py === undefined) return;
    const trigger = document.activeElement as HTMLElement | null; // restore focus here on close
    btns(menuRef.current)[0]?.focus(); // focus first item so Esc/arrows/Enter work without a click
    return () => {
      closeSub(); // never reopen with a stale submenu
      trigger?.focus?.();
    };
  }, [px, py, closeSub]);

  // Listener-only effect. `onClose` is a caller-supplied prop that MAY be a fresh
  // closure each render, so this re-runs often — harmless, because its cleanup only
  // detaches listeners. Keep it that way: no closeSub()/focus() in this teardown.
  useEffect(() => {
    if (px === undefined || py === undefined) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const inSub = !!(el && subRef.current?.contains(el));
      // Esc unwinds one level at a time: submenu first, then the whole menu.
      if (e.key === "Escape") return subIdx.current === null ? onClose() : closeSub(true);
      // Tab must not walk out of the portal leaving both panels open (APG: Tab
      // dismisses the menu); cleanup then restores focus to the live trigger.
      if (e.key === "Tab") { e.preventDefault(); return onClose(); }
      if (e.key === "ArrowRight" && !inSub && el?.dataset.sub !== undefined) {
        e.preventDefault();
        return openSub(Number(el.dataset.sub), el.getBoundingClientRect(), { kbd: true });
      }
      if (e.key === "ArrowLeft" && subIdx.current !== null) {
        e.preventDefault();
        return closeSub(true);
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      const list = btns(inSub ? subRef.current : menuRef.current); // navigate the FOCUSED panel only
      if (!list.length) return;
      const i = list.indexOf(el as HTMLButtonElement);
      const step = e.key === "ArrowUp" ? -1 : 1;
      const next = e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : (i + step + list.length) % list.length;
      list[next]?.focus();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [px, py, onClose, closeSub, openSub]);

  // Measure the real panel (labels vary) before paint, then reposition/flip; the
  // pre-measure estimate below keeps the first frame in the right neighbourhood.
  useLayoutEffect(() => {
    const el = subRef.current;
    if (!sub || !el) return;
    const r = el.getBoundingClientRect();
    setSubSize((s) => (s && s.w === r.width && s.h === r.height ? s : { w: r.width, h: r.height }));
    if (sub.kbd) el.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
  }, [sub]);

  if (!pos) return null;
  // Shared shell layout: LEFT-aligned rows, icon on the LEFT, accent-fill hover
  // on the --primary token (never a hex). Metrics are per-persona + pointer-aware
  // (see menuMetrics) and BOTH panels share them.
  const m = menuMetrics(active.id);
  // Clamp on all four edges (Math.max lower-bounds so a click near the bottom/right
  // of a small viewport can't push the menu offscreen). Per-row height is variant-
  // aware so the bottom clamp reserves enough for the taller touch rows.
  const x = Math.max(8, Math.min(pos.x, window.innerWidth - 220));
  const y = Math.max(8, Math.min(pos.y, window.innerHeight - items.length * m.rowH - 12));
  const open = sub && items[sub.i]?.type === "submenu" ? (items[sub.i] as Extract<MenuItem, { type: "submenu" }>) : null;
  const sp = sub && open
    ? submenuPos(sub.row, subSize ?? { w: 220, h: open.items.length * m.rowH + 8 }, { w: window.innerWidth, h: window.innerHeight })
    : null;

  return createPortal(
    <>
      {/* Above the dock (z-880) and menu bar (z-900): a right-click near the bottom
          must sit OVER the dock, and the backdrop must swallow clicks on the chrome
          (else a click launches an app while the menu is open). */}
      <div className="fixed inset-0 z-[1200]" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div
        ref={menuRef}
        role="menu"
        onMouseLeave={leaveSub}
        className={cn(PANEL, "z-[1201]", m.radius, m.motion)}
        style={{ left: x, top: y }}
      >
        <MenuRows items={items} m={m} onClose={onClose} sub={{ open: sub?.i ?? null, onOpen: openSub, onLeave: leaveSub }} />
      </div>
      {open && sp && (
        <SubPanel item={open} m={m} onClose={onClose} pos={sp} panelRef={subRef} onEnter={cancelClose} onLeave={leaveSub} />
      )}
    </>,
    document.body,
  );
}
