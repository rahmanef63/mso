"use client";

import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useShellDesign } from "../../../design";
import { useShellUI } from "../../../registry/shell-ui";
import { ControlCenterTiles } from "./control-center-tiles";
import { IosControlCenter } from "./control-center-ios";

// One quick-settings behavior model, shell-native presentation. iOS uses a glass
// pull-down; Android uses a solid/tonal Material sheet. No fake Wi-Fi/cellular
// controls — only real MSO toggles are shared between the two renderers.
export function ControlCenter() {
  const { controlCenterOpen: open, setControlCenterOpen: onOpenChange } = useShellUI();
  const design = useShellDesign();
  const apple = design.family === "apple";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        data-slot="shell-control-center"
        data-shell-id={design.id}
        data-shell-family={design.family}
        side="top"
        className={cn(
          "border-border p-4 pt-[max(2.25rem,var(--sai-top,0px))]",
          apple
            ? "rounded-b-[34px] border-white/10 bg-black/35 shadow-none backdrop-blur-2xl"
            : "rounded-b-[28px] bg-card shadow-xl",
        )}
      >
        <SheetTitle className="sr-only">Control Center</SheetTitle>
        <SheetDescription className="sr-only">Quick system toggles</SheetDescription>
        <div className="mx-auto w-full max-w-md">
          {apple ? <IosControlCenter onClose={() => onOpenChange(false)} /> : <ControlCenterTiles onClose={() => onOpenChange(false)} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}
