"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// One grouped-list row: label left, control right, with a hairline divider drawn
// on the row itself (inset 16px) so dividers land only between real rows — never
// around the custom blocks some sections drop into the card. Stacks the control
// under the label on narrow widths so segmented controls never overflow.
export function SettingsRow({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="settings-row"
      className={cn(
        "relative flex min-h-[46px] flex-col gap-2 px-4 py-[11px] @min-[600px]:flex-row @min-[600px]:items-center @min-[600px]:justify-between",
        "after:absolute after:inset-x-0 after:bottom-0 after:left-4 after:h-px after:bg-border/60 last:after:hidden",
        className,
      )}
    >
      <span data-slot="settings-row-label" className="text-sm text-foreground">{label}</span>
      <div className="min-w-0 w-full @min-[600px]:w-auto @min-[600px]:shrink-0">{children}</div>
    </div>
  );
}

// A read-only value row: label left, muted value right, ALWAYS inline (unlike
// SettingsRow, which stacks its control under the label on narrow widths — right
// for segmented/switch controls, wrong for a short read-only value like "8 GB").
export function SettingsValueRow({
  label,
  value,
  className,
}: {
  label: string;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="settings-row"
      className={cn(
        "relative flex min-h-[46px] items-center justify-between gap-3 px-4 py-[11px]",
        "after:absolute after:inset-x-0 after:bottom-0 after:left-4 after:h-px after:bg-border/60 last:after:hidden",
        className,
      )}
    >
      <span data-slot="settings-row-label" className="shrink-0 text-sm text-foreground">{label}</span>
      <span data-slot="settings-value" className="min-w-0 truncate text-right text-[13px] text-muted-foreground">{value}</span>
    </div>
  );
}
