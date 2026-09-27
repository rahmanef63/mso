"use client";

import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** One crumb. Ancestors set `onSelect` or `href`. The last crumb is the current page. */
export type SettingsBreadcrumb = {
  label: string;
  href?: string;
  onSelect?: () => void;
};

/**
 * Optional settings breadcrumb trail. Omit `items` (or pass an empty list) and
 * nothing is rendered, so a feature cell that does not opt in stays unchanged.
 */
export function SettingsBreadcrumbs({
  items,
  className,
}: {
  items?: readonly SettingsBreadcrumb[] | null;
  className?: string;
}) {
  if (!items?.length) return null;
  return (
    <nav aria-label="Breadcrumb" data-slot="settings-breadcrumbs" className={cn("min-w-0", className)}>
      <ol className="flex flex-wrap items-center gap-1 text-sm">
        {items.map((item, index) => {
          const current = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="inline-flex min-w-0 items-center gap-1">
              {index > 0 ? <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : null}
              {current ? (
                <span aria-current="page" className="truncate px-2 font-medium text-foreground">{item.label}</span>
              ) : item.onSelect ? (
                <Button type="button" variant="ghost" className="min-h-11 px-2" onClick={item.onSelect}>{item.label}</Button>
              ) : item.href ? (
                <Button asChild variant="ghost" className="min-h-11 px-2"><a href={item.href}>{item.label}</a></Button>
              ) : (
                <span className="truncate px-2 text-muted-foreground">{item.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * Settings feature cell. Pass `breadcrumbs` to show a trail above the cell;
 * omit the prop and the children render with no extra wrapper.
 */
export function SettingsFeatureCell({
  breadcrumbs,
  children,
  className,
}: {
  breadcrumbs?: readonly SettingsBreadcrumb[] | null;
  children: ReactNode;
  className?: string;
}) {
  if (!breadcrumbs?.length) return <>{children}</>;
  return (
    <div data-slot="settings-feature-cell" className={cn("space-y-4", className)}>
      <SettingsBreadcrumbs items={breadcrumbs} />
      {children}
    </div>
  );
}
