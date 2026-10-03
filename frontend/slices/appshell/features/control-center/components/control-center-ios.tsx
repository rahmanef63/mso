"use client";

import { type LucideIcon, Bell, Moon, MoonStar, Sun, Server, Cloud, Sparkles, Layers, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useWindowOrder } from "../../../hooks/use-shell";
import { closeAll, toggleInspector, toggleSpotlight } from "../../../lib/store";
import { toggleFocusMode, useFocusMode } from "../../../lib/focus-mode";
import { useShellAppearance, useServerToggle } from "../../../registry/capabilities";

/** iOS Control Center is a mosaic of glass tiles. The macOS popover keeps the
 *  shared labeled list. Only real MSO toggles are here. */
export function IosControlCenter({ onClose }: { onClose: () => void }) {
  const { theme, setTheme } = useShellAppearance();
  const server = useServerToggle();
  const openCount = useWindowOrder().length;
  const focus = useFocusMode();
  const dark = theme === "dark";

  return (
    <div data-slot="ios-control-center" className="grid grid-cols-2 gap-3">
      <div data-slot="ios-cc-cluster" className="grid grid-cols-2 place-items-center gap-3 rounded-[28px] border border-white/20 bg-[var(--glass-bar)] p-3">
        <Orb icon={dark ? Moon : Sun} label="Appearance" on={dark} onClick={() => setTheme(dark ? "light" : "dark")} />
        <Orb icon={focus ? MoonStar : Bell} label="Focus" on={focus} onClick={toggleFocusMode} />
        <Orb icon={Search} label="Search" onClick={() => { onClose(); toggleSpotlight(); }} />
        {server ? (
          <Orb icon={server.live ? Cloud : Server} label="Server" on={server.live} disabled={server.locked} onClick={server.toggle} />
        ) : (
          <Orb icon={Layers} label="Windows" disabled={openCount === 0} onClick={() => { closeAll(); onClose(); }} />
        )}
      </div>
      <Button
        type="button"
        variant="ghost"
        onClick={() => { onClose(); toggleInspector(); }}
        className="h-auto min-h-[164px] flex-col items-start justify-between rounded-[28px] border border-white/20 bg-[var(--glass-bar)] p-4 text-left hover:bg-white/10"
      >
        <span className="grid size-11 place-items-center rounded-full bg-white/20">
          <Sparkles className="size-5" aria-hidden />
        </span>
        <span>
          <span className="block text-[15px] font-semibold">Alfa</span>
          <span className="block text-[12px] text-white/70">Ask about this app</span>
        </span>
      </Button>
      {server && (
        <Tile icon={Layers} label="Windows" value={openCount ? `Close all (${openCount})` : "None open"} disabled={openCount === 0} onClick={() => { closeAll(); onClose(); }} />
      )}
    </div>
  );
}

function Orb({
  icon: Icon, label, on = false, disabled = false, onClick,
}: { icon: LucideIcon; label: string; on?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn("size-14 rounded-full p-0", on ? "bg-primary text-primary-foreground hover:bg-primary" : "bg-white/25 text-white hover:bg-white/35")}
    >
      <Icon className="size-6" />
    </Button>
  );
}

function Tile({
  icon: Icon, label, value, disabled = false, onClick,
}: { icon: LucideIcon; label: string; value: string; disabled?: boolean; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      disabled={disabled}
      onClick={onClick}
      className="h-[88px] flex-col items-start justify-between rounded-[24px] border border-white/20 bg-[var(--glass-bar)] px-3.5 py-3 text-left hover:bg-white/10 disabled:opacity-40"
    >
      <Icon className="size-5" aria-hidden />
      <span>
        <span className="block text-[13px] font-semibold leading-tight">{label}</span>
        <span className="block truncate text-[11px] text-white/70">{value}</span>
      </span>
    </Button>
  );
}
