"use client";

/**
 * app-chrome — the internal AppSidebar block composed by AppFrame.
 *
 * Consumers: use AppFrame (appshell/primitives/app-frame.tsx) at the app slice
 * level. AppFrame supplies the @container scaffolding + safe-area padding +
 * header/toolbar/footer slots; the chrome pieces here render the regions
 * (top toolbar, side sheets/rails) inside those slots.
 *
 * Don't import these pieces directly from app slices — go through AppFrame.
 */

import { type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useContainer } from "../../responsive/use-container";
import { useIsMobile } from "../../responsive/use-is-mobile";
import { cn } from "@/lib/utils";

// Mobile Sheet chrome (radix Sheet) loads only on phones, in its own async
// chunk. Desktop renders the plain <aside> rail below and never ships it.
const MobileSideRegion = dynamic(
  () => import("./app-chrome-mobile").then((m) => m.MobileSideRegion),
  { ssr: false, loading: () => null },
);

// Reusable app-window chrome so every app reads the same. All regions are
// OPTIONAL — an app composes only what it needs.
//   • Mobile (viewport < 768): Sidebar → left Sheet.
//   • Desktop: inline rail, shown unless `railOpen={false}` (a desktop collapse
//     toggle). Forms / previews use <FormDrawer> (dialog ⇄ bottom drawer).
// Apps that toggle a panel on both form factors branch their handler with
// `useIsMobile()` from the shell's responsive module.

function SideRegion({
  open,
  onOpenChange,
  side,
  railOpen,
  compact,
  title,
  description,
  railBase,
  railClassName,
  sheetWidth,
  sheetClassName,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side: "left" | "right";
  railOpen: boolean;
  compact: boolean;
  title: string;
  description?: string;
  railBase: string;
  railClassName?: string;
  sheetWidth: string;
  sheetClassName?: string;
  children: ReactNode;
}) {
  const isMobile = useIsMobile();
  if (isMobile || compact) {
    return (
      <MobileSideRegion
        open={open}
        onOpenChange={onOpenChange}
        side={side}
        title={title}
        description={description}
        sheetWidth={sheetWidth}
        sheetClassName={sheetClassName}
      >
        {children}
      </MobileSideRegion>
    );
  }
  if (!railOpen) return null;
  return <aside className={cn(railBase, railClassName)}>{children}</aside>;
}

// Left navigation. Inline rail on desktop (hide via railOpen); left Sheet on
// mobile. Keep `children` layout-agnostic — they render in either slot.
export function AppSidebar({
  open,
  onOpenChange,
  railOpen = true,
  title = "Sidebar",
  description,
  railClassName,
  sheetClassName,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  railOpen?: boolean;
  title?: string;
  description?: string;
  railClassName?: string;
  sheetClassName?: string;
  children: ReactNode;
}) {
  const [measureRef, pane] = useContainer<HTMLDivElement>();
  return (
    <>
    <div ref={measureRef} aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-0" />
    <SideRegion
      open={open}
      onOpenChange={onOpenChange}
      side="left"
      railOpen={railOpen}
      compact={pane === "xs" || pane === "sm"}
      title={title}
      description={description}
      railBase="flex w-56 shrink-0 flex-col border-r border-border bg-sidebar"
      railClassName={railClassName}
      sheetWidth="w-72 sm:max-w-xs"
      sheetClassName={sheetClassName}
    >
      {children}
    </SideRegion>
    </>
  );
}
