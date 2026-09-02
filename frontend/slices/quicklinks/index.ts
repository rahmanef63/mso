import { Link2 } from "lucide-react";
import type { AppDescriptor } from "@/features/appshell";

// Barrel: the app layer imports only this. The window component is lazy-loaded
// via `load` so its bundle is deferred until the Quicklinks window opens.
export const quicklinksApp: AppDescriptor = {
  id: "quicklinks",
  title: "Quicklinks",
  icon: Link2,
  gradient: "linear-gradient(160deg,#a78bfa,#7c3aed)",
  load: () => import("./app"),
  defaultSize: { w: 520, h: 460 },
  // The dock already shows the individual favicon shortcuts; keep the manager
  // window out of it (still in Launchpad / mobile grid / Spotlight / /links).
  noDock: true,
};
