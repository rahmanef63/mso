"use client";

import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

type GraphNodeShellProps = ComponentProps<"div"> & {
  selected?: boolean;
};

/** Domain-independent graph node chrome. Feature slices own handles, content and domain state. */
export function GraphNodeShell({ selected = false, className, ...props }: GraphNodeShellProps) {
  return (
    <div
      {...props}
      className={cn(
        "relative rounded-xl border bg-card p-3 shadow-sm transition-[box-shadow,border-color,opacity]",
        selected && "ring-2 ring-ring shadow-md",
        className,
      )}
    />
  );
}
