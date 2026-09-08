import { Settings } from "lucide-react";
import type { AppDescriptor } from "@/features/appshell";

// Barrel: the only thing the app layer imports. Exposes the app descriptor;
// the component itself is lazy-loaded via `load` so its bundle is deferred.
export const osSettingsApp: AppDescriptor = {
  id: "os-settings",
  title: "Settings",
  shellTitles: { macos: "System Settings", windows: "Settings" },
  icon: Settings,
  gradient: "linear-gradient(160deg,#8a8f99,#5b6068)",
  load: () => import("./app"),
  defaultSize: { w: 960, h: 660 },
};
