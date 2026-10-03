"use client";

import { useEffect, useRef } from "react";
import { useApps } from "../lib/registry";
import { useWindowOrder, useFocused, useWindowsMap } from "../hooks/use-shell";
import { setLauncherOpen } from "../lib/store";
import { useDockPrefs, DOCK_SIZE_PX } from "../lib/dock-prefs";
import { useQuickLinks } from "../registry/capabilities";
import { useResponsive } from "../responsive/use-responsive";
import { DockIcon, PlainIcon } from "./dock-parts";
import { QuicklinkIcon } from "./quicklink-icon";
import type { AppDescriptor, WindowState } from "../lib/types";

// ── macOS dock magnification ─────────────────────────────────────────────────
// Icon size is driven by LAYOUT width so the glass bar grows + re-centres as icons
// magnify, and magnification CONSERVES total width: a FIXED pool (DOCK_EXTRA) is
// shared out by a gaussian weight, so the bar has just TWO widths — collapsed at
// rest, one stable expanded size on hover. Icons are square, so it grows in height
// too. Distance is measured against each slot's FIXED rest centre (invariant under
// symmetric growth), so there's no measure→grow feedback.
const SEP_W = 11; // divider slot — kit separator is a 1px hairline with 5px of side padding
const GAP = 9; // px between slots (macOS 27 dock)
const MAG_SIGMA = 100; // bell-curve spread (≈3 icons each side ripple)
const MIN_ICON = 22; // shrink floor — past it the row scrolls instead

// Resting icon size shrinks to fit the viewport, like the real macOS dock: slots
// are shrink-0, so an overrun silently eats BOTH ends (Launchpad + Mission Control
// included) — and agent workspaces add one app per discovered Hermes/OpenClaw
// feature, i.e. dozens of extra slots. Past the floor even shrinking can't fit the
// row, so it scrolls; magnification is off there (it assumes an unscrolled row).
export function dockFit(vw: number, count: number, seps: number, max: number, magnify: boolean) {
  const reserve = magnify ? Math.round(max * 0.6) : 0; // hover growth headroom
  const room = vw - 32 - GAP * (count - 1) - SEP_W * seps - reserve;
  const fit = Math.floor(room / Math.max(1, count - seps));
  const cramped = fit < MIN_ICON;
  const base = Math.max(MIN_ICON, Math.min(max, fit));
  return { base, cramped, dockExtra: magnify && !cramped ? Math.round(base * 2.2) : 0 };
}

type Slot =
  | { kind: "app"; app: AppDescriptor; windows: WindowState[] }
  | { kind: "sep" }
  | { kind: "plain"; id: string; label: string; onClick: () => void; node: React.ReactNode };

export function Dock({ onMissionControl }: { onMissionControl?: () => void }) {
  const apps = useApps().filter((a) => !a.noDock);
  const order = useWindowOrder();
  const focused = useFocused();
  const { items: links, open: openLink } = useQuickLinks();
  // Reactive read: re-renders on any window patch (e.g. minimize) so the hover
  // window-list + running state never go stale under an order-only subscription.
  const winMap = useWindowsMap();
  const wins = order.map((id) => winMap[id]).filter(Boolean) as WindowState[];
  const rowRef = useRef<HTMLDivElement>(null);
  // Dock size + magnification are user prefs (Settings → Appearance). The magnify
  // pool derives from the base size → peak icon ≈ 1.5× (subtler than the old fixed
  // 340px that ballooned peaks to ~2.6× — the "too lebay" hover the owner flagged).
  const { size, magnify } = useDockPrefs();
  const { vw } = useResponsive();

  const slots: Slot[] = [
    ...apps.map((app): Slot => ({ kind: "app", app, windows: wins.filter((w) => w.app === app.id) })),
    // Quicklinks ride in their own dock cluster after the app separator.
    ...(links.length
      ? [
          { kind: "sep" } as Slot,
          ...links.map(
            (link): Slot => ({
              kind: "plain",
              id: `ql-${link.id}`,
              label: link.title,
              onClick: () => openLink(link),
              node: <QuicklinkIcon link={link} />,
            }),
          ),
        ]
      : []),
    { kind: "sep" },
    {
      kind: "plain", id: "launchpad", label: "Launchpad", onClick: () => setLauncherOpen(true),
      node: (
        // eslint-disable-next-line @next/next/no-img-element
        <img src="/app-icons/launchpad.webp" alt="" aria-hidden className="size-full" draggable={false} decoding="async" />
      ),
    },
    ...(onMissionControl
      ? [{
          kind: "plain", id: "mission-control", label: "Mission Control", onClick: onMissionControl,
          node: (
            // eslint-disable-next-line @next/next/no-img-element
            <img src="/app-icons/mission-control.webp" alt="" aria-hidden className="size-full" draggable={false} decoding="async" />
          ),
        } as Slot]
      : []),
  ];

  const seps = slots.filter((s) => s.kind === "sep").length;
  const { base, cramped, dockExtra } = dockFit(vw, slots.length, seps, DOCK_SIZE_PX[size], magnify);

  // Each slot's resting centre, as an offset from the row centre (fixed geometry).
  const restW = (s: Slot) => (s.kind === "sep" ? SEP_W : base);
  const totalRest = slots.reduce((a, s) => a + restW(s), 0) + GAP * (slots.length - 1);
  let acc = 0;
  const restOffset = slots.map((s) => {
    const c = acc + restW(s) / 2 - totalRest / 2;
    acc += restW(s) + GAP;
    return c;
  });
  // Constant normaliser = the gaussian weight-sum with the cursor at the row centre
  // (its MAX). Dividing the pool by THIS — not the live sum — keeps the icon under
  // the cursor the same size everywhere: at an edge fewer neighbours exist, so the
  // live sum shrinks and the edge icon would hog the pool ("edge icons balloon").
  const restNorm =
    restOffset.reduce(
      (a, off, i) => (slots[i].kind === "sep" ? a : a + Math.exp(-(off * off) / (2 * MAG_SIGMA * MAG_SIGMA))),
      0,
    ) || 1;

  // ── Magnification is driven OUTSIDE React (no re-render per pointermove). The
  // hover x is kept in a ref; a single rAF reads the row centre ONCE then writes
  // each slot's width + zone height straight to the DOM; CSS transitions animate it.
  const slotEls = useRef<(HTMLDivElement | null)[]>([]);
  const zoneEls = useRef<(HTMLDivElement | null)[]>([]);
  const mouseX = useRef<number | null>(null);
  const raf = useRef(0);

  const apply = () => {
    raf.current = 0;
    const row = rowRef.current;
    if (!row) return;
    const mx = mouseX.current;
    const hovering = mx != null;
    const rc = row.getBoundingClientRect(); // ONE read per frame (no per-slot reflow)
    const rowCenter = rc.left + rc.width / 2;
    const weights = slots.map((s, i) => {
      if (!hovering || s.kind === "sep") return 0;
      const d = mx! - (rowCenter + restOffset[i]);
      return Math.exp(-(d * d) / (2 * MAG_SIGMA * MAG_SIGMA));
    });
    slots.forEach((s, i) => {
      if (s.kind === "sep") return;
      // Normalise by the constant restNorm (not Σ weights) → consistent icon size
      // at every position; the bar's total growth eases off naturally at the edges.
      const w = base + (hovering ? dockExtra * (weights[i] / restNorm) : 0);
      const slot = slotEls.current[i];
      const zone = zoneEls.current[i];
      if (slot) slot.style.width = `${w}px`;
      if (zone) zone.style.height = `${w}px`;
    });
  };
  const schedule = () => { if (!raf.current) raf.current = requestAnimationFrame(apply); };

  // Re-apply after any structural re-render (focus / windows) so a mid-hover
  // re-render doesn't snap icons back to rest. Also cancels the rAF on unmount.
  useEffect(() => {
    if (mouseX.current != null) schedule();
    // Zero the guard after cancelling: apply() (the only other reset) was just
    // cancelled, so a stale handle here permanently blocks schedule()'s
    // `if (!raf.current)` — the intermittent "dock stuck big" bug.
    return () => { if (raf.current) { cancelAnimationFrame(raf.current); raf.current = 0; } };
  });

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-1 z-[880] flex justify-center">
      {/* The scroll container is this WRAPPER, never the glass row: `overflow-x`
          forces `overflow-y` from visible to auto (CSS Overflow 3 §3.2), and every
          DockIcon HoverPanel sits `bottom-full` — ABOVE the row — so scrolling the
          row itself hides the tooltips/window menus this mitigation exists for.
          Clipping is at the PADDING box, so pt-64 gives the tallest panel room and
          -mt-64 leaves the bar where it was; `contents` = no box at all (identical
          layout) whenever the row still fits. Stays pointer-events-none: wheel/touch
          over the row scrolls it anyway, and the headroom swallows no clicks. */}
      <div className={cramped ? "-mt-64 max-w-[calc(100vw-16px)] overflow-x-auto pt-64 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" : "contents"}>
        <div
          ref={rowRef}
          onPointerMove={(e) => { mouseX.current = e.clientX; schedule(); }}
          onPointerLeave={() => { mouseX.current = null; schedule(); }}
          className={`glass pointer-events-auto flex items-end rounded-full border border-black/10 px-2 pb-1 pt-2 shadow-[0_0_0_0.5px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(255,255,255,0.45)] dark:border-white/10 dark:shadow-[0_0_0_0.5px_rgba(255,255,255,0.12),inset_0_1px_0_rgba(255,255,255,0.08)] ${cramped ? "w-max" : ""}`}
          style={{ background: "var(--shell-dock-bg, var(--dock-bg))", gap: GAP }}
        >
          {slots.map((s, i) => {
            if (s.kind === "sep") {
              return <div key={`sep-${i}`} className="flex shrink-0 self-stretch items-center justify-center" style={{ width: SEP_W }}><span className="my-1.5 h-9 w-px bg-black/30 mix-blend-plus-lighter dark:bg-white/35" /></div>;
            }
            const slotRef = (el: HTMLDivElement | null) => { slotEls.current[i] = el; };
            const zoneRef = (el: HTMLDivElement | null) => { zoneEls.current[i] = el; };
            return s.kind === "app" ? (
              <DockIcon key={s.app.id} app={s.app} windows={s.windows} focused={focused} base={base} slotRef={slotRef} zoneRef={zoneRef} />
            ) : (
              <PlainIcon key={s.id} label={s.label} onClick={s.onClick} base={base} slotRef={slotRef} zoneRef={zoneRef}>{s.node}</PlainIcon>
            );
          })}
        </div>
      </div>
    </div>
  );
}
