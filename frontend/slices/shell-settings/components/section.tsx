"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// A titled settings group: an uppercase muted caption above a grouped card, so
// stacked sections read as the macOS/iOS System Settings list. Rows inside carry
// their own inset hairline dividers (see SettingsRow). `footnote` renders a muted
// caption BELOW the card — the iOS grouped-list footer, where explanatory text
// belongs (never flush inside the card). Freeform in-card content should use
// SettingsBlock so it isn't flush to the border.
export function SettingsSection({
  icon,
  title,
  children,
  footnote,
  bare = false,
  className,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  footnote?: ReactNode;
  /** Skip the grouped-card wrapper — for children that bring their own surface
   *  (e.g. a panel of its own cards), so they don't nest a card-in-card. */
  bare?: boolean;
  className?: string;
}) {
  return (
    <section className={cn("space-y-2", className)}>
      <div data-slot="settings-section-heading" className="flex items-center gap-2 px-1 text-muted-foreground">
        <span data-slot="settings-section-icon" className="[&_svg]:size-3.5">{icon}</span>
        <span data-slot="settings-section-title" className="text-[11px] font-semibold uppercase tracking-wide">{title}</span>
      </div>
      {bare ? children : <div data-slot="settings-card" className="overflow-hidden rounded-xl border bg-card">{children}</div>}
      {footnote && (
        <p data-slot="settings-footnote" className="px-1 text-[11px] leading-relaxed text-muted-foreground">{footnote}</p>
      )}
    </section>
  );
}
