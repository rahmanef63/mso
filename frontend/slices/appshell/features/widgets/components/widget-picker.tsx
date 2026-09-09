"use client";

import { Component, type ReactNode } from "react";
import { Check } from "lucide-react";
import { ResponsiveDialog as FormDrawer } from "../../../primitives/responsive-dialog";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { WIDGET_META, setPickerOpen, setWidgetsOn, toggleWidget, usePickerOpen, useWidgetState } from "../widget-registry";
import { WIDGET_RENDER } from "./widgets-defs";
// Intra-slice import (not the @/features/appshell barrel) to avoid a self-cycle.
import { useActiveShell } from "../../../registry/shells";

// A real widget mounted mini can throw (or a poll can fail mid-render); a crash
// guard keeps one bad preview from taking down the whole picker.
class PreviewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="grid h-full place-items-center text-[10px] text-muted-foreground">preview</div>
    ) : (
      this.props.children
    );
  }
}

// Desktop-widget picker — a live-preview gallery (uses the shared shell layout):
// each card mounts the REAL widget clipped to a small box (pointer-events-none so
// it's non-interactive), and clicking the card adds/removes it. Arrange by
// dragging widgets on the desktop (no up/down reorder here anymore).
export function WidgetPicker() {
  const open = usePickerOpen();
  const { on, enabled } = useWidgetState();
  // On the phone Today view there is no "desktop" and no drag-to-arrange — the
  // shared picker relabels for that surface (its only per-shell divergence).
  const mobile = useActiveShell().surface === "mobile";
  return (
    <FormDrawer open={open} onOpenChange={setPickerOpen} size="md">
      <FormDrawer.Header>
        <FormDrawer.Title>{mobile ? "Add Widget" : "Desktop widgets"}</FormDrawer.Title>
        <FormDrawer.Description>
          {mobile
            ? "Tap a widget to add or remove it."
            : "Click a widget to add or remove it. Drag widgets on the desktop to arrange."}
        </FormDrawer.Description>
      </FormDrawer.Header>

      <FormDrawer.Body>
        <label className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
          <span className="font-medium">{mobile ? "Show widgets" : "Show desktop widgets"}</span>
          <Switch checked={on} onCheckedChange={setWidgetsOn} />
        </label>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {WIDGET_META.map((w) => {
            const Render = WIDGET_RENDER[w.id];
            const isOn = enabled.includes(w.id);
            return (
              <button
                key={w.id}
                type="button"
                onClick={() => toggleWidget(w.id)}
                aria-label={`${isOn ? "Remove" : "Add"} ${w.title}`}
                aria-pressed={isOn}
                className={cn(
                  "flex flex-col gap-1.5 rounded-xl border p-1.5 text-left transition-colors",
                  isOn ? "border-primary/60 bg-primary/5" : "border-border hover:border-primary/40",
                )}
              >
                <div className="pointer-events-none relative h-24 w-full overflow-hidden rounded-lg bg-muted/30 p-1">
                  <PreviewBoundary>{Render ? <Render /> : null}</PreviewBoundary>
                  {isOn && (
                    <span className="absolute right-1 top-1 z-20 grid size-4 place-items-center rounded-full bg-primary text-primary-foreground">
                      <Check className="size-3" />
                    </span>
                  )}
                  {/* Transparent shield on top: a click toggles the card and never
                      drives the live preview's own controls (some widgets render
                      pointer-events-auto, which would otherwise fire their side effects). */}
                  <span aria-hidden className="pointer-events-auto absolute inset-0 z-10" />
                </div>
                <span className="px-1 text-xs font-medium">{w.title}</span>
              </button>
            );
          })}
        </div>
      </FormDrawer.Body>
    </FormDrawer>
  );
}
