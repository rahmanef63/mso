import { Image } from "lucide-react";
import type { AppDescriptor } from "@/features/appshell";

// Barrel: the only thing the app layer imports. Exposes the app descriptor;
// the component itself is lazy-loaded via `load` so its bundle is deferred.
export const mediaStudioApp: AppDescriptor = {
  id: "media-studio",
  title: "Image Editor",
  icon: Image,
  gradient: "linear-gradient(160deg,#ff9f43,#ee5253)",
  load: () => import("./app"),
  defaultSize: { w: 1180, h: 760 },
};
