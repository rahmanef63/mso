import { Sparkles } from "lucide-react";
import type { AppDescriptor } from "@/features/appshell";

// Barrel: the only thing the app layer imports. Exposes the app descriptor;
// the component itself is lazy-loaded via `load` so its bundle is deferred.
export const assistantApp: AppDescriptor = {
  id: "assistant",
  title: "Alfa",
  icon: Sparkles,
  gradient: "linear-gradient(160deg,#a855f7,#6d28d9)",
  load: () => import("./app"),
  defaultSize: { w: 520, h: 620 },
};

// Publishes @ agents and / skills+tools to the shared composer.
//
// Imported dynamically rather than re-exported statically: `alfa-sources` imports
// `HOST_TOOLS` from `host-tools/catalog`, a large tool-schema catalog. A static
// re-export here leaked that catalog into the first-load chunk because shell.manifest
// imports `assistantApp` from this barrel. The dynamic import keeps HOST_TOOLS
// deferred until an AI composer actually requests completion sources.
let alfaSourcesModule: Promise<typeof import("./lib/alfa-sources")> | null = null;
const loadAlfaSources = () => (alfaSourcesModule ??= import("./lib/alfa-sources"));

export async function installAlfaSources(): Promise<void> {
  const { installAlfaSources: install } = await loadAlfaSources();
  install();
}
