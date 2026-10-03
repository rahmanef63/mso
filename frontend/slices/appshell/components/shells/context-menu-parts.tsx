"use client";
/* ContextMenu rows + per-shell metrics — shared verbatim by the root panel and
   the submenu panel (context-menu.tsx owns position, state and keyboard). Split
   out so both files stay small; nothing here holds state. */
import { cn } from "@/lib/utils";
import { Check, ChevronRight, type LucideIcon } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import type { MenuItem } from "../../lib/context-menu";

/** Panel chrome shared by the root menu and the submenu. max-height + scroll is
 *  belt-and-suspenders so a panel can NEVER run off the viewport regardless of
 *  row-height drift (it scrolls instead of clipping). */
export const PANEL =
  "fixed max-h-[calc(100dvh-16px)] min-w-[200px] overflow-y-auto border border-border bg-popover/95 p-1 text-sm shadow-2xl backdrop-blur-md animate-in";

/** Exactly one submenu can be open at a time, so its id is a constant. The parent
 *  row points at it with BOTH aria-controls and aria-owns: the panel is a portalled
 *  SIBLING, not a DOM child, so without aria-owns no AT ever links the two. */
export const SUBMENU_ID = "shell-context-submenu";

/** Per-persona metrics/motion, read fresh at open time from the active shell:
 *  macOS = dense + zoom-in; Windows = Fluent (34px rows, fixed icon gutter,
 *  slide-down); iOS/Android = 44pt touch targets + larger text (HIG). Reads the
 *  POINTER too — the a11y rule (@media pointer:coarse → [role=menuitem]
 *  {min-height:44px} in globals.css) forces tall rows even under a desktop
 *  shell, so a persona-only rowH under-reserves height and the menu clips. */
export function menuMetrics(shell: string) {
  const isWin = shell === "windows";
  const isTouch = shell === "ios" || shell === "android";
  const coarse = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
  return {
    isWin,
    isTouch,
    /** No hover on a coarse pointer → submenus open on TAP instead. */
    tap: isTouch || coarse,
    rowH: isTouch || coarse ? 44 : isWin ? 34 : 24,
    item: isWin ? "h-[34px] rounded-[4px]" : isTouch ? "min-h-11 rounded-lg py-2.5 text-[15px]" : "h-6 rounded-[5px] px-0 text-[13px] font-medium",
    motion: isWin ? "fade-in-0 slide-in-from-top-2 duration-150" : "fade-in zoom-in-95 duration-100",
    radius: isWin ? "rounded-lg" : isTouch ? "rounded-2xl" : "rounded-[12px]",
    chrome: isWin || isTouch ? "" : "border-black/10 bg-white/75 px-3 py-[5px] text-[13px] shadow-[0_0_0_0.5px_rgba(0,0,0,0.12),0_8px_48px_rgba(0,0,0,0.25)] backdrop-blur-xl dark:border-white/10 dark:bg-[rgba(44,44,48,0.88)]",
    iconSize: isTouch ? "size-[18px]" : "size-4",
  };
}
export type MenuMetrics = ReturnType<typeof menuMetrics>;

/** The submenu controller the root panel hands down. Absent = no nesting here
 *  (a submenu inside a submenu renders disabled rather than dead). */
export type SubControl = {
  /** Index of the row whose panel is open. */
  open: number | null;
  onOpen: (i: number, rect: DOMRect, opts?: { toggle?: boolean }) => void;
  /** Pointer reached a plain row — dismiss any open panel (delayed). */
  onLeave: () => void;
};

const ROW =
  "group flex w-full items-center gap-2.5 px-2.5 text-left outline-none transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:bg-primary focus-visible:text-primary-foreground disabled:opacity-40 disabled:hover:bg-transparent";
const GLYPH = "shrink-0 text-primary group-hover:text-primary-foreground group-focus-visible:text-primary-foreground";

function RowBody({ m, icon: Icon, label, trailing }: { m: MenuMetrics; icon?: LucideIcon; label: string; trailing?: ReactNode }) {
  return (
    <>
      {m.isWin ? (
        // Fixed icon gutter — an empty same-size slot keeps every label's left
        // edge aligned even when a row has no icon (Fluent rows).
        <span className="flex size-4 shrink-0 items-center justify-center">{Icon && <Icon className={cn("size-4", GLYPH)} />}</span>
      ) : (
        Icon && <Icon className={cn(m.iconSize, GLYPH)} />
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
    </>
  );
}

/** The one nested panel — a SIBLING of the root panel inside the same portal
 *  (nesting it would clip it inside the root's overflow-y-auto). Its rows get no
 *  SubControl, so a deeper submenu renders disabled instead of dead. */
export function SubPanel({ item, m, onClose, pos, panelRef, onEnter, onLeave }: {
  item: Extract<MenuItem, { type: "submenu" }>;
  m: MenuMetrics;
  onClose: () => void;
  pos: { x: number; y: number };
  panelRef: RefObject<HTMLDivElement | null>;
  onEnter: () => void;
  onLeave: () => void;
}) {
  return (
    <div
      ref={panelRef}
      id={SUBMENU_ID}
      role="menu"
      aria-label={item.label}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      className={cn(PANEL, "z-[1202]", m.radius, m.chrome, m.motion)}
      style={{ left: pos.x, top: pos.y }}
    >
      <MenuRows items={item.items} m={m} onClose={onClose} />
    </div>
  );
}

export function MenuRows({ items, m, onClose, sub }: { items: MenuItem[]; m: MenuMetrics; onClose: () => void; sub?: SubControl }) {
  return (
    <>
      {items.map((it, i) => {
        if (it.type === "sep") return <div key={i} role="separator" className="my-1 h-px bg-border" />;
        if (it.type === "submenu")
          return (
            <button
              type="button"
              key={i}
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={sub?.open === i}
              aria-controls={sub?.open === i ? SUBMENU_ID : undefined}
              aria-owns={sub?.open === i ? SUBMENU_ID : undefined}
              data-sub={sub ? i : undefined}
              disabled={it.disabled || !sub}
              onClick={(e) => sub?.onOpen(i, e.currentTarget.getBoundingClientRect(), { toggle: true })}
              onMouseEnter={(e) => !m.tap && sub?.onOpen(i, e.currentTarget.getBoundingClientRect())}
              className={cn(ROW, "text-foreground/90", m.item, m.tap && "min-h-11", sub?.open === i && "bg-accent")}
            >
              <RowBody m={m} icon={it.icon} label={it.label} trailing={<ChevronRight className="size-4 shrink-0 opacity-60" />} />
            </button>
          );
        return (
          <button
            type="button"
            key={i}
            role={it.checked === undefined ? "menuitem" : "menuitemradio"}
            aria-checked={it.checked}
            disabled={it.disabled}
            onClick={() => { it.onClick(); onClose(); }}
            onMouseEnter={() => !m.tap && sub?.onLeave()}
            className={cn(ROW, it.danger ? "text-destructive-text" : "text-foreground/90", m.item, m.tap && "min-h-11")}
          >
            <RowBody
              m={m}
              icon={it.icon}
              label={it.label}
              trailing={
                <>
                  {/* Selection is a GLYPH, never colour alone (a11y). */}
                  {it.checked && <Check className="size-4 shrink-0" />}
                  {/* macOS-style right-aligned keyboard hint (display only). */}
                  {it.shortcut && <span className="shrink-0 pl-4 text-xs tabular-nums opacity-50 group-hover:opacity-80">{it.shortcut}</span>}
                </>
              }
            />
          </button>
        );
      })}
    </>
  );
}
