"use client";

import { LayoutGrid } from "lucide-react";
import { registerCommands } from "../../lib/commands";
import { registerContextMenu } from "../../lib/context-menu";
import { toast } from "../../lib/toast";
import {
  getWidgetState,
  setPickerOpen,
  setWidgetsOn,
  usePickerOpen,
  useWidgetState,
} from "./widget-registry";
import { DeferredSurface } from "../../primitives/deferred-surface";

registerCommands("desktop-widgets", [
  {
    id: "widgets:desktop",
    label: "Toggle desktop widgets",
    hint: "Widgets",
    keywords: "glance dashboard wallpaper stats",
    run: () => {
      const next = !getWidgetState().on;
      setWidgetsOn(next);
      toast(next ? "Desktop widgets on" : "Desktop widgets off");
    },
  },
  {
    id: "widgets:configure",
    label: "Configure desktop widgets",
    hint: "Widgets",
    keywords: "desktop widget picker add remove reorder",
    run: () => setPickerOpen(true),
  },
]);

registerContextMenu("macos", () => [
  { label: "Desktop widgets…", icon: LayoutGrid, onClick: () => setPickerOpen(true) },
]);

const loadDesktop = () => import("./components/desktop-widgets").then((m) => ({ default: m.DesktopWidgets }));
const loadMobile = () => import("./components/mobile-widgets").then((m) => ({ default: m.MobileWidgets }));

export function DeferredDesktopWidgets() {
  const { on } = useWidgetState();
  const pickerOpen = usePickerOpen();
  return <DeferredSurface active={on || pickerOpen} load={loadDesktop} label="Desktop Widgets" keepMounted />;
}

export function DeferredMobileWidgets() {
  return <DeferredSurface active={true} load={loadMobile} label="Widgets" keepMounted />;
}
