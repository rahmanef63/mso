import { Waypoints } from "lucide-react";
import type { AppDescriptor } from "@/features/appshell";

// Memory is a first-class shell app. The window bundle stays lazy.
export const memoryGraphApp: AppDescriptor = {
  id: "memory-graph",
  title: "Memory",
  icon: Waypoints,
  gradient: "var(--primary)",
  load: () => import("./app"),
  defaultSize: { w: 1080, h: 720 },
};
