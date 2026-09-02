import { Wand2 } from "lucide-react";
import type { AppDescriptor } from "@/features/appshell";

// Barrel: the only thing the app layer imports. Exposes the app descriptor;
// the component itself is lazy-loaded via `load` so its bundle is deferred.
export const createAppApp: AppDescriptor = {
  id: "create-app",
  title: "Create App",
  icon: Wand2,
  gradient: "linear-gradient(160deg,#22d3ee,#0891b2)",
  load: () => import("./app"),
  defaultSize: { w: 520, h: 560 },
};
