import { Activity } from "lucide-react";
import type { AppDescriptor } from "@/features/appshell";

// Barrel: the only thing the app layer imports. Exposes the app descriptor;
// the component itself is lazy-loaded via `load` so its bundle is deferred.
export const systemMonitorApp: AppDescriptor = {
  id: "system-monitor",
  title: "System Monitor",
  icon: Activity,
  gradient: "linear-gradient(160deg,#34d058,#15a345)",
  load: () => import("./app"),
  defaultSize: { w: 440, h: 520 },
};
