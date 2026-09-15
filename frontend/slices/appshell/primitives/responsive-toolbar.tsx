"use client";

import type { ComponentType } from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useResponsive } from "../responsive/use-responsive";

export type ToolbarItem = {
  id: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  onClick: () => void;
  /** Stays inline even when compact (overflow-collapses the rest). */
  primary?: boolean;
  disabled?: boolean;
};

// Declare actions as DATA; the toolbar decides inline vs overflow. The feature
// pane owns compactness when it has a local container contract; otherwise the
// shell mobile state remains the safe default. This avoids measuring the
// shrink-to-content toolbar itself, which creates circular width decisions.
export function ResponsiveToolbar({
  items,
  className,
  compact: compactOverride,
}: {
  items: ToolbarItem[];
  className?: string;
  compact?: boolean;
}) {
  const { isMobile } = useResponsive();
  const compact = compactOverride ?? isMobile;
  const inline = compact ? items.filter((i) => i.primary) : items;
  const overflow = compact ? items.filter((i) => !i.primary) : [];

  return (
    <div className={cn("flex min-w-0 items-center gap-1", className)}>
      {inline.map((i) => (
        <Button
          key={i.id}
          size="sm"
          variant="ghost"
          onClick={i.onClick}
          disabled={i.disabled}
          className="gap-1.5 [@media(pointer:coarse)]:min-h-[44px]"
        >
          {i.icon && <i.icon className="size-4" />}
          <span className={cn(compact && "sr-only")}>{i.label}</span>
        </Button>
      ))}
      {overflow.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" aria-label="More actions" className="[@media(pointer:coarse)]:size-[44px]">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {overflow.map((i) => (
              <DropdownMenuItem key={i.id} onClick={i.onClick} disabled={i.disabled}>
                {i.icon && <i.icon className="mr-2 size-4" />}
                {i.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
