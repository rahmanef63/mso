import { Eye } from "lucide-react";
import type { AppDescriptor } from "@/features/appshell";

// Barrel: app layer imports only this descriptor. The component is lazy-loaded
// via `load`. noDock — opened from the launcher, not pinned to the dock.
// The format table is part of the slice's public surface: Files decides what to
// icon and where to route with the SAME map the viewer renders from, so the two can
// never disagree about what "previewable" means.
export { kindForName, kindForExt, isPreviewable, isTextual, type ViewKind } from "./lib/kinds";

export const mediaViewerApp: AppDescriptor = {
  id: "media-viewer",
  title: "Preview",
  icon: Eye,
  gradient: "linear-gradient(160deg,#1dd1a1,#10ac84)",
  load: () => import("./app"),
  defaultSize: { w: 720, h: 540 },
  noDock: true,
};
