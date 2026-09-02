import { defineFeature } from "../../registry/types";
import { MobileWidgets } from "./components/mobile-widgets";
import { DesktopWidgets } from "./components/desktop-widgets";

// Widgets — the iOS "Today" page (mobile home pager) + the desktop
// wallpaper-layer widget stack (opt-in, behind every window).
export const widgetsFeature = defineFeature({
  id: "widgets",
  slots: { today: MobileWidgets, desktopWidgets: DesktopWidgets },
});
