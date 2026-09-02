import { Code2 } from "lucide-react";
import type { AppDescriptor } from "@/features/appshell";

// Barrel: the only thing the app layer imports. Exposes the app descriptor;
// the component itself is lazy-loaded via `load` so its bundle is deferred.
export const codeEditorApp: AppDescriptor = {
  id: "code-editor",
  title: "Code",
  icon: Code2,
  gradient: "linear-gradient(160deg,#ff5f8f,#b5179e)",
  load: () => import("./app"),
  defaultSize: { w: 820, h: 560 },
};
