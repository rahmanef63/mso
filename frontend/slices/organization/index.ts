import { Network } from "lucide-react";
import type { AppDescriptor } from "@/features/appshell";

export const organizationApp: AppDescriptor = {
  id: "organization",
  title: "Organization",
  icon: Network,
  gradient: "linear-gradient(160deg,#2563eb,#0f172a)",
  prefetch: "never",
  load: () => import("./app"),
  defaultSize: { w: 1120, h: 720 },
};

export { OrganizationView } from "./lazy-view";
