"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useShellDesign } from "@/features/os-shell";
import type { Theme } from "@/lib/appearance";

function PhonePreview({ mode, family }: { mode: Theme; family: "apple" | "material" }) {
  const dark = mode === "dark";
  if (family === "apple") {
    return (
      <span className={cn("relative mx-auto block h-[132px] w-[74px] overflow-hidden rounded-[14px] border shadow-sm", dark ? "border-white/10 bg-[#111217]" : "border-black/10 bg-[#f4f4f7]") }>
        <span className={cn("absolute inset-x-2 top-3 h-3 rounded-full", dark ? "bg-white/80" : "bg-black/75")} />
        <span className={cn("absolute inset-x-2 top-10 h-9 rounded-[8px]", dark ? "bg-[#292a30]" : "bg-white")} />
        <span className={cn("absolute inset-x-2 top-[82px] h-7 rounded-[8px]", dark ? "bg-[#292a30]" : "bg-white")} />
      </span>
    );
  }
  return (
    <span className={cn("relative mx-auto block h-[124px] w-[78px] overflow-hidden rounded-[22px] border shadow-sm", dark ? "border-white/10 bg-[#161217]" : "border-black/10 bg-[#f8f7fb]") }>
      <span className={cn("absolute left-3 right-3 top-3 h-7 rounded-full", dark ? "bg-[#2d2830]" : "bg-[#e8e1ea]")} />
      <span className={cn("absolute bottom-3 left-3 h-11 w-11 rounded-[18px]", dark ? "bg-[#322b37]" : "bg-[#e9dff0]")} />
      <span className={cn("absolute bottom-3 right-3 h-11 w-3 rounded-full", dark ? "bg-[#47364d]" : "bg-[#d8c2e3]")} />
    </span>
  );
}

export function ThemeModePicker({ value, onChange }: { value: Theme; onChange: (theme: Theme) => void }) {
  const design = useShellDesign();
  const family = design.family === "material" ? "material" : "apple";

  return (
    <div data-slot="theme-mode-picker" data-shell-family={design.family} className="grid grid-cols-2 gap-4 px-1 py-1">
      {(["light", "dark"] as const).map((mode) => {
        const selected = value === mode;
        return (
          <button
            key={mode}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(mode)}
            className={cn(
              "rounded-[18px] px-2 py-3 text-center transition-colors",
              design.family === "material" ? "active:bg-secondary" : "active:bg-[var(--fill)]",
            )}
          >
            <PhonePreview mode={mode} family={family} />
            <span className="mt-2 block text-[16px] font-medium capitalize text-foreground">{mode}</span>
            <span className={cn(
              "mx-auto mt-2 grid size-7 place-items-center rounded-full border-2",
              selected ? "border-info bg-info text-white" : "border-muted-foreground/45 text-transparent",
            )}>
              <Check className="size-4" aria-hidden />
            </span>
          </button>
        );
      })}
    </div>
  );
}
