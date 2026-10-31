import { defineFeature } from "../../registry/types";
import { DeferredDesktopWidgets, DeferredMobileWidgets } from "./deferred";

// Widgets — the iOS "Today" page (mobile home pager) + the desktop
// wallpaper-layer widget stack (opt-in, behind every window).
export const widgetsFeature = defineFeature({
  id: "widgets",
  slots: { today: DeferredMobileWidgets, desktopWidgets: DeferredDesktopWidgets },
});
