"use client";

import { useState } from "react";
import { BatteryMedium, SlidersHorizontal, Volume2, Wifi } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ControlCenterTiles } from "./control-center-tiles";

// Desktop Control Center — a menu-bar trailing glyph opening a popover of the SAME
// real toggles as the mobile CC. Mounted via the `menuBarStatus` slot, so it lives
// only in the macOS menu bar (the only surface that renders that region). No
// fabricated-hardware sliders — VPS essence, same as the mobile CC.
/** @param size box size in px. 28 suits the macOS menu bar (this component's
 *  original and still default home). The Windows taskbar row is 40px per the
 *  Fluent table, and a 28px box there left one visibly short item next to the
 *  clock — so the taskbar passes 40 rather than every surface being bumped. */
export function ControlCenterDesktop({ size = 28, variant = "default" }: { size?: number; variant?: "default" | "windows" } = {}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label="Control Center" className="rounded-md text-foreground hover:bg-foreground/10" style={{ width: size, height: variant === "windows" ? 40 : size }}>
          {variant === "windows" ? (
            <span className="flex items-center gap-1.5" aria-hidden>
              <Wifi className="size-4" />
              <Volume2 className="size-4" />
              <BatteryMedium className="size-[18px]" />
            </span>
          ) : (
            <SlidersHorizontal className="size-4" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className={variant === "windows"
          ? "glass w-80 rounded-xl border-border bg-[var(--glass-menu)] p-3"
          : "glass w-80 rounded-[26px] border-black/10 bg-white/75 p-3 shadow-[0_0_0_0.5px_rgba(0,0,0,0.12),0_18px_48px_rgba(0,0,0,0.25)] dark:border-white/10 dark:bg-[rgba(44,44,48,0.88)]"}
      >
        <ControlCenterTiles onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
