"use client";

import { type LucideIcon, Bell, Moon, MoonStar, Sun, Server, Cloud, Sparkles, Layers, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useWindowOrder } from "../../../hooks/use-shell";
import { closeAll, toggleInspector, toggleSpotlight } from "../../../lib/store";
import { toggleFocusMode, useFocusMode } from "../../../lib/focus-mode";
import { useShellAppearance, useServerToggle } from "../../../registry/capabilities";

const WELL = "border border-white/15 bg-white/18";

/** Packed glass mosaic: a 2×2 circle group, a tall card beside it, then two
 *  lower tiles. Only real MSO toggles. The macOS popover keeps the labeled list. */
export function IosControlCenter({ onClose }: { onClose: () => void }) {
  const { theme, setTheme } = useShellAppearance();
  const server = useServerToggle();
  const openCount = useWindowOrder().length;
  const focus = useFocusMode();
  const dark = theme === "dark";
  const windowsLabel = openCount ? `Close all (${openCount})` : "None open";

  return (
    <div data-slot="ios-control-center" className="grid grid-cols-4 gap-2.5">
      <div data-slot="ios-cc-cluster" className={cn(WELL, "col-span-2 row-span-2 grid grid-cols-2 place-items-center gap-2.5 rounded-[28px] p-3")}>
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
        data-slot="ios-cc-card"
        onClick={() => { onClose(); toggleInspector(); }}
        className={cn(WELL, "col-span-2 row-span-2 h-auto min-h-[168px] flex-col items-start justify-between rounded-[28px] p-4 text-left text-white hover:bg-white/25")}
      >
        <span className="grid size-11 place-items-center rounded-2xl bg-white/20">
          <Sparkles className="size-5" aria-hidden />
        </span>
        <span>
          <span className="block text-[15px] font-semibold">Alfa</span>
          <span className="block text-[12px] text-white/70">Ask about this app</span>
        </span>
      </Button>
      <Tile
        icon={Layers}
        label="Windows"
        value={windowsLabel}
        disabled={openCount === 0}
        onClick={() => { closeAll(); onClose(); }}
      />
      <Tile
        icon={server ? (server.live ? Cloud : Server) : Search}
        label={server ? "Server" : "Search"}
        value={server ? server.label : "Spotlight"}
        disabled={server?.locked}
        onClick={() => {
          if (server) server.toggle();
          else { onClose(); toggleSpotlight(); }
        }}
      />
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
      className={cn("size-[52px] rounded-full p-0", on ? "bg-primary text-primary-foreground hover:bg-primary" : "bg-white/25 text-white hover:bg-white/35")}
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
      className={cn(WELL, "col-span-2 h-[78px] flex-col items-start justify-between rounded-[22px] px-3.5 py-3 text-left text-white hover:bg-white/25 disabled:opacity-40")}
    >
      <Icon className="size-5" aria-hidden />
      <span>
        <span className="block text-[13px] font-semibold leading-tight">{label}</span>
        <span className="block truncate text-[11px] text-white/70">{value}</span>
      </span>
    </Button>
  );
}
