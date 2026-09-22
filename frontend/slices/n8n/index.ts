import { Waypoints } from "lucide-react";
import type { AppDescriptor } from "@/features/appshell";

export const n8nApp: AppDescriptor = {
  id: "n8n",
  title: "n8n",
  icon: Waypoints,
  gradient: "var(--primary)",
  prefetch: "never",
  load: () => import("./app"),
  defaultSize: { w: 1180, h: 760 },
};
