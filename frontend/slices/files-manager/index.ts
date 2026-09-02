import { FolderOpen } from "lucide-react";
import type { AppDescriptor } from "@/features/appshell";

// Barrel: the only thing the app layer imports. The component is lazy-loaded
// via `load` so its bundle is deferred until the window opens.
export const filesManagerApp: AppDescriptor = {
  id: "files-manager",
  title: "Files",
  icon: FolderOpen,
  gradient: "linear-gradient(160deg,#3b9bff,#2f6fe0)",
  load: () => import("./app"),
  defaultSize: { w: 760, h: 520 },
  multi: true,
};
