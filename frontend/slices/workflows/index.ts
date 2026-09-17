import { Workflow } from "lucide-react";
import type { AppDescriptor } from "@/features/appshell";

export const workflowsApp: AppDescriptor = {
  id: "workflows",
  title: "Workflows",
  icon: Workflow,
  gradient: "var(--primary)",
  prefetch: "never",
  load: () => import("./app"),
  defaultSize: { w: 1180, h: 760 },
};
