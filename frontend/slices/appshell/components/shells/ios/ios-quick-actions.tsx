"use client";

import { AppWindow, LayoutGrid, Lock, MinusCircle, Search, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AppDescriptor } from "../../../lib/types";

type Point = { x: number; y: number };

/** Home-icon quick actions. A floating menu, not a bottom sheet: Remove App,
 *  Require Face ID, Edit Home Screen, then the app's own actions, and a footer
 *  of the same real shortcuts. */
export function IosQuickActions({
  app,
  point,
  onOpen,
  onRemove,
  onLock,
  onEditHome,
  onSearch,
  onClose,
}: {
  app: AppDescriptor;
  point: Point;
  onOpen: () => void;
  onRemove: () => void;
  onLock: () => void;
  onEditHome: () => void;
  onSearch: () => void;
  onClose: () => void;
}) {
  const extras = (app.menus ?? []).flatMap((m) => m.items).filter(
    (it): it is Extract<typeof it, { label: string }> => !("sep" in it),
  ).slice(0, 4);
  const left = typeof window === "undefined" ? point.x : Math.min(Math.max(12, point.x - 28), window.innerWidth - 272);
  const top = typeof window === "undefined" ? point.y : Math.min(Math.max(12, point.y + 8), window.innerHeight - 360);

  return (
    <div className="absolute inset-0 z-[45]" onClick={onClose}>
      <div
        data-slot="ios-quick-actions"
        role="menu"
        className="glass absolute w-[250px] overflow-hidden rounded-[22px] border border-white/30 bg-[var(--glass-menu)] text-[var(--text)] shadow-2xl"
        style={{ left, top }}
        onClick={(e) => e.stopPropagation()}
      >
        <Row icon={MinusCircle} label="Remove App" destructive onClick={() => { onClose(); onRemove(); }} />
        <Row icon={Lock} label="Require Face ID" onClick={() => { onClose(); onLock(); }} />
        <Row icon={LayoutGrid} label="Edit Home Screen" onClick={() => { onClose(); onEditHome(); }} />
        {extras.map((it, i) => (
          <Row key={i} label={it.label} disabled={it.disabled} onClick={() => { onClose(); it.onSelect?.(); }} />
        ))}
        <div className="grid grid-cols-4 border-t border-border">
          <Footer icon={AppWindow} label={`Open ${app.title}`} onClick={() => { onClose(); onOpen(); }} />
          <Footer icon={Search} label="Search" onClick={() => { onClose(); onSearch(); }} />
          <Footer icon={Lock} label="Lock" onClick={() => { onClose(); onLock(); }} />
          <Footer icon={LayoutGrid} label="Edit Home Screen" onClick={() => { onClose(); onEditHome(); }} />
        </div>
      </div>
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  destructive = false,
  disabled = false,
  onClick,
}: {
  icon?: LucideIcon;
  label: string;
  destructive?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`h-auto min-h-11 w-full justify-start gap-3 rounded-none border-t border-border px-3.5 py-2.5 text-left text-[17px] font-normal first:border-t-0 hover:bg-foreground/5 ${destructive ? "text-destructive hover:text-destructive" : ""}`}
    >
      {Icon && <Icon className="size-[18px] shrink-0" aria-hidden />}
      <span className="truncate">{label}</span>
    </Button>
  );
}

function Footer({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" aria-label={label} onClick={onClick} className="h-12 rounded-none p-0 hover:bg-foreground/5">
      <Icon className="size-[18px]" aria-hidden />
    </Button>
  );
}
