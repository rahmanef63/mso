"use client";

// The mobile Sheet branch of app-chrome's SideRegion. Lifted into its own async
// chunk so desktop never ships radix Sheet at first paint — loaded via
// next/dynamic from app-chrome.tsx only when a phone renders a sidebar.
// (A vaul bottom-drawer variant lived here too; its only route in was
// AppInspector, which no app ever mounted. Both deleted 2026-08-10.)

import { type ReactNode } from "react";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useShellDesign } from "../../design/use-shell-design";

export function MobileSideRegion({
  open,
  onOpenChange,
  side,
  title,
  description,
  sheetWidth,
  sheetClassName,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side: "left" | "right";
  title: string;
  description?: string;
  sheetWidth: string;
  sheetClassName?: string;
  children: ReactNode;
}) {
  const design = useShellDesign();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        data-slot="shell-side-region"
        data-shell-id={design.id}
        data-shell-family={design.family}
        data-shell-density={design.density}
        side={side}
        className={cn(
          sheetWidth,
          "p-0",
          design.family === "apple" && "rounded-r-[22px] border-y border-r",
          design.family === "material" && "rounded-r-[28px] border-y border-r bg-card",
          sheetClassName,
        )}
      >
        <SheetTitle className="sr-only">{title}</SheetTitle>
        <SheetDescription className="sr-only">{description ?? title}</SheetDescription>
        <div className="flex h-full w-full min-h-0 flex-col overflow-y-auto">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
