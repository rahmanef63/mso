import { Plug } from "lucide-react";
import type { AppDescriptor } from "@/features/appshell";

/** First-class shell descriptor for MSO's canonical Integrations workbench. */
export const integrationsApp: AppDescriptor = {
  id: "integrations",
  title: "Integrations",
  icon: Plug,
  gradient: "var(--primary)",
  load: () => import("./app"),
  defaultSize: { w: 1040, h: 720 },
};
