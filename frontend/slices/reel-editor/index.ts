import { Clapperboard } from "lucide-react";
import type { AppDescriptor } from "./lib/host";

// Barrel: the only thing the app layer imports. Exposes the app descriptor;
// the component itself is lazy-loaded via `load` so its bundle is deferred.
export const reelEditorApp: AppDescriptor = {
  id: "reel-editor",
  title: "Video Editor",
  icon: Clapperboard,
  gradient: "linear-gradient(160deg,#7a5cff,#5b2fe0)",
  prefetch: "never",
  load: () => import("./app"),
  defaultSize: { w: 920, h: 600 },
};
