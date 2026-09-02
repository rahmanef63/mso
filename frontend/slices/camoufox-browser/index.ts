import { ScanEye } from "lucide-react";
import type { AppDescriptor } from "@/features/appshell";

export const camoufoxBrowserApp: AppDescriptor = {
  id: "camoufox-browser",
  title: "Camoufox",
  icon: ScanEye,
  gradient: "linear-gradient(160deg,#111827,#0f766e)",
  load: () => import("./app"),
  defaultSize: { w: 980, h: 680 },
};
