"use client";
/* Per-element context-menu ZONES + collect-up-the-DOM nesting.

   A zone maps a DOM element → a provider that returns MenuItem[] AT OPEN TIME.
   Any feature attaches a right-click menu to any element with ONE ref, and it
   nests automatically: right-click walks target → root, and every element that
   carries a zone contributes ONE group, innermost first (a file row → its list →
   the window → the shell). One WeakMap, one hook, no dependency bookkeeping —
   providers run lazily at click time, so the closure is always fresh.

   The <ContextMenuHost> (mounted once at #main-content) does the walking + owns
   the shared <ContextMenu> renderer. See context-menu-host.tsx. */
import { useCallback, useEffect, useRef } from "react";
import type { MenuItem, ContextMenuCtx } from "./context-menu";

// A provider gets the shell ctx (id/surface/x/y) PLUS the node the click hit
// (`target`) and the element this zone is bound to (`element`).
export type ZoneCtx = ContextMenuCtx & { target: Element; element: Element };

// Return items, or { items, stop } to STOP the upward walk here ("this level
// only" — ancestors AND the shell/global registry are skipped). So
// `{ items: [], stop: true }` = "contribute nothing AND keep the NATIVE menu"
// (the escape hatch for a terminal / <textarea> that wants OS copy-paste).
export type ZoneResult = MenuItem[] | { items: MenuItem[]; stop?: boolean };
export type ZoneProvider = (ctx: ZoneCtx) => ZoneResult;

const ZONES = new WeakMap<Element, ZoneProvider>();

/** Low-level bind (element → provider). Returns an unbind fn. */
export function attachZone(el: Element, provide: ZoneProvider): () => void {
  ZONES.set(el, provide);
  return () => {
    if (ZONES.get(el) === provide) ZONES.delete(el);
  };
}

/** Ref callback: `<div ref={useContextZone(c => [...])}>`.
 *  No deps: the provider runs at OPEN time, so a fresh closure each render is
 *  all that's needed. A useRef keeps the latest closure while the ref callback
 *  stays stable — the DOM node is never detached/reattached. React 19 runs the
 *  returned cleanup on unmount. */
export function useContextZone(provide: ZoneProvider) {
  const ref = useRef(provide);
  useEffect(() => {
    ref.current = provide;
  });
  return useCallback((el: Element | null): (() => void) | void => {
    if (!el) return;
    return attachZone(el, (c) => ref.current(c));
  }, []);
}

/** Walk target → parentElement, calling every zone en route; each zone's items
 *  become ONE group (innermost first). `sealed` = a zone said stop. */
export function collectZones(
  target: Element,
  base: ContextMenuCtx,
): { groups: MenuItem[][]; sealed: boolean } {
  const groups: MenuItem[][] = [];
  for (let el: Element | null = target; el; el = el.parentElement) {
    const provide = ZONES.get(el);
    if (!provide) continue;
    const res = provide({ ...base, target, element: el });
    const items = Array.isArray(res) ? res : res.items;
    const stop = !Array.isArray(res) && !!res.stop;
    if (items.length) groups.push(items);
    if (stop) return { groups, sealed: true };
  }
  return { groups, sealed: false };
}
