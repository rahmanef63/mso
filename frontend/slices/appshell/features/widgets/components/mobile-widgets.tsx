"use client";

import { createElement } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApps, useShellUI, useActiveShell, AppIcon, type AppDescriptor } from "@/features/appshell";
import { Card } from "./widget-cards";
import { useWidgetState, setPickerOpen } from "../widget-registry";
import { WIDGET_RENDER } from "./widgets-defs";
import { WidgetPicker } from "./widget-picker";

// Today view (swipe right from home) — renders the SAME editable widget set the
// desktop stack uses (widget-registry), so a user's chosen widgets (Clock/Notes/
// Quicklinks/system) follow them to mobile. Widgets here are naturally
// interactive (no pointer-events-none wrapper). Plus a mobile-only "Quick open"
// app row from the shell-UI context.
export function MobileWidgets() {
  const apps = useApps();
  const shell = useActiveShell();
  const { quickAppIds: quickIds, openApp: onOpen } = useShellUI();
  const { enabled } = useWidgetState();

  const quick = quickIds.map((id) => apps.find((a) => a.id === id)).filter(Boolean) as AppDescriptor[];

  return (
    <div data-slot="mobile-widgets" className="flex h-full w-full min-w-0 max-w-full flex-col gap-3 overflow-x-clip overflow-y-auto px-4 py-3 [scrollbar-width:none]">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-[28px] font-extrabold tracking-[-0.02em] text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.5)]">{shell.id === "android" ? "Widgets" : "Today"}</h2>
        {/* Edit the glanceable VPS telemetry set right from the phone — opens the
            shared widget picker (add/remove Clock/Notes/Quicklinks/CPU/Mem/…). */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setPickerOpen(true)}
          className="h-8 gap-1.5 rounded-full bg-white/15 px-3 text-[13px] font-medium text-white backdrop-blur hover:bg-white/25 hover:text-white [@media(pointer:coarse)]:min-h-[44px]"
        >
          <Plus className="size-4" /> Edit
        </Button>
      </div>

      {enabled.map((id) => {
        const Render = WIDGET_RENDER[id];
        return Render ? createElement(Render, { key: id }) : null;
      })}

      {quick.length > 0 && (
        <Card>
          <span className="mb-2 block text-[12px] font-semibold text-muted-foreground">Quick open</span>
          <div data-slot="quick-open-grid" className="grid min-w-0 max-w-full grid-cols-4 gap-x-3 gap-y-3 overflow-x-clip">
            {quick.map((app) => (
              <Button key={app.id} type="button" variant="ghost" onClick={() => onOpen(app)} className="h-auto min-w-0 max-w-full p-0 hover:bg-transparent flex flex-col items-center gap-1.5 overflow-hidden">
                <span className="size-12">
                  <AppIcon app={app} />
                </span>
                <span className="max-w-[56px] truncate text-[10.5px] font-medium">{app.title}</span>
              </Button>
            ))}
          </div>
        </Card>
      )}

      {/* The picker Dialog is desktop-only in the tree; mount it here so the phone
          Today view can open it (portals to body, so page inert-ness is fine). */}
      <WidgetPicker />
    </div>
  );
}
