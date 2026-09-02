import { BookOpen } from "lucide-react";
import type { AppDescriptor } from "@/features/appshell";

// Barrel: the app layer imports only this. The window is lazy-loaded via `load`
// so the docs bundle is deferred until the window opens.
export const docsApp: AppDescriptor = {
  id: "docs",
  title: "Docs",
  icon: BookOpen,
  gradient: "linear-gradient(160deg,#38bdf8,#0369a1)",
  load: () => import("./app"),
  defaultSize: { w: 620, h: 560 },
};
