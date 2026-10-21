"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ResponsiveDialog } from "@/features/appshell";
import { Button } from "@/components/ui/button";
import { DynamicIcon } from "./DynamicIcon";
import { PickerSkeleton } from "./PickerSkeleton";
import type { IconPickerInlineProps } from "./IconPickerInline";

/** Lazy-loaded picker body. Catalogs (~600 emoji strings, ~250 lucide
 *  imports, ~190 phosphor imports) sit in this chunk — pages that never
 *  open the picker pay zero JS for the catalog. */
const IconPickerInlineLazy = React.lazy(() =>
  import("./IconPickerInline").then((m) => ({ default: m.IconPickerInline })),
);

interface IconPickerPopoverProps extends Omit<IconPickerInlineProps, "onSelect"> {
  children?: React.ReactNode;
  /** Controlled open state. Omit to let the popover manage its own. */
  open?: boolean;
  /** Notified on every open-state change. */
  onOpenChange?: (open: boolean) => void;
  /** Fired ONLY on icon pick — NOT on color pick. Auto-closes. */
  onSelect?: () => void;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
}

/** Minimum vertical space (px) needed on a side: picker chrome (~150) plus a
 *  usable grid (~190). Below this we promote to a centered Dialog. */
const PICKER_MIN_FIT_PX = 340;
const PICKER_EDGE_PADDING = 12;
/** Below this viewport width the ~360px popover would overflow horizontally. */
const PICKER_MIN_VIEWPORT_WIDTH = 360;

/** Smart picker wrapper with auto-flip + center-screen fallback.
 *
 *  Behaviour contract:
 *    - Color pick → picker stays open. Consumer's `onChange` fires.
 *    - Icon pick → picker auto-closes. `onChange` + `onSelect` fire.
 *    - Defers mounting the picker body until first open.
 *    - Wraps body in `<Suspense fallback={<PickerSkeleton />}>`.
 *
 *  Layout is decided once, when the picker opens (event handler, not an
 *  effect): a 340px-tall surface either fits beside the trigger or the picker
 *  becomes a dialog. Radix's `avoidCollisions` handles small drifts after that;
 *  a resize while open keeps the chosen shape for the rest of the interaction. */
export function IconPickerPopover({
  value,
  onChange,
  onClear,
  onSelect,
  children,
  open: controlledOpen,
  onOpenChange,
  align = "start",
  side = "bottom",
}: IconPickerPopoverProps) {
  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = isControlled ? !!controlledOpen : internalOpen;

  /** Mounted once, never unmounted: the lazy chunk and the recents ring should
   *  survive closing so a second open is instant. */
  const [everOpened, setEverOpened] = React.useState(false);
  const [layout, setLayout] = React.useState<"popover" | "dialog">("popover");
  const triggerRef = React.useRef<HTMLElement | null>(null);
  const setTriggerRef = React.useCallback((node: HTMLElement | null) => {
    triggerRef.current = node;
  }, []);

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (next) {
        setEverOpened(true);
        const node = triggerRef.current;
        if (node && typeof window !== "undefined") {
          const rect = node.getBoundingClientRect();
          const above = rect.top - PICKER_EDGE_PADDING;
          const below = window.innerHeight - rect.bottom - PICKER_EDGE_PADDING;
          const fitsAnySide = above >= PICKER_MIN_FIT_PX || below >= PICKER_MIN_FIT_PX;
          setLayout(fitsAnySide && window.innerWidth >= PICKER_MIN_VIEWPORT_WIDTH ? "popover" : "dialog");
        }
      }
      if (!isControlled) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );

  const handleSelect = React.useCallback(() => {
    setOpen(false);
    onSelect?.();
  }, [setOpen, onSelect]);

  const trigger = (
    <Slot ref={setTriggerRef}>
      {children ?? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-border transition hover:bg-accent"
          style={{ fontSize: "1.5rem" }}
          aria-label="Change icon"
        >
          <DynamicIcon value={value} size={24} />
        </Button>
      )}
    </Slot>
  );

  const body = everOpened ? (
    <React.Suspense fallback={<PickerSkeleton />}>
      <IconPickerInlineLazy
        value={value}
        onChange={onChange}
        onClear={onClear}
        onSelect={handleSelect}
      />
    </React.Suspense>
  ) : (
    <PickerSkeleton />
  );

  // A popover that could not fit becomes a centered dialog. It goes through
  // ResponsiveDialog so the bottom sheet / panel variants match every other feature
  // form instead of a raw Dialog. The hidden Popover keeps the trigger element
  // mounted in the same position.
  if (layout === "dialog") {
    return (
      <Popover open={false} onOpenChange={() => {}}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <ResponsiveDialog open={open} onOpenChange={setOpen} size="md">
          <ResponsiveDialog.Body className="flex flex-col gap-0 p-3" style={{ height: "min(560px, 88dvh)" }}>
            {body}
          </ResponsiveDialog.Body>
        </ResponsiveDialog>
      </Popover>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align={align}
        side={side}
        sideOffset={6}
        collisionPadding={PICKER_EDGE_PADDING}
        avoidCollisions
        className="flex flex-col overflow-hidden p-3"
        style={{ width: 360, maxHeight: "min(var(--radix-popover-content-available-height), 520px)" }}
      >
        {body}
      </PopoverContent>
    </Popover>
  );
}

/** Re-export the inline picker (eager) for consumers that already render it
 *  inside an existing surface and don't want the popover/lazy wrapper. */
export { IconPickerInline } from "./IconPickerInline";
