import { Settings } from "lucide-react";
import type { AppDescriptor } from "@/features/os-shell";

// Barrel: the only thing the app layer imports. Exposes the app descriptor;
// the component itself is lazy-loaded via `load` so its bundle is deferred.
export const osSettingsApp: AppDescriptor = {
  id: "os-settings",
  title: "Settings",
  icon: Settings,
  gradient: "linear-gradient(160deg,#8a8f99,#5b6068)",
  load: () => import("./app"),
  defaultSize: { w: 840, h: 600 },
};
