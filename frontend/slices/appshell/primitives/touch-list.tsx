"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useResponsive } from "../responsive/use-responsive";

// A list whose rows grow to ≥44px hit targets on coarse pointers (touch), and
// stay compact with a fine pointer (mouse). Pass plain children — the min-height
// is enforced via a child selector so existing row markup doesn't need to change.
export function TouchList({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const { pointer } = useResponsive();
  return (
    <div
      className={cn(
        "flex flex-col",
        pointer === "coarse" && "[&>*]:min-h-11",
        className,
      )}
    >
      {children}
    </div>
  );
}

