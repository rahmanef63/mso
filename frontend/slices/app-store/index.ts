import { Store } from "lucide-react";
import type { AppDescriptor } from "@/features/appshell";

// Barrel: the only thing the app layer imports. Exposes the app descriptor;
// the component itself is lazy-loaded via `load` so its bundle is deferred.
export const appStoreApp: AppDescriptor = {
  id: "app-store",
  title: "App Store",
  icon: Store,
  gradient: "linear-gradient(160deg,#9b5cff,#5b2fe0)",
  load: () => import("./app"),
  defaultSize: { w: 820, h: 600 },
};

// The dynamic half of the registry — installed/created apps as descriptors.
export { useInstalledApps } from "./lib/use-installed-apps";
export { useApps, setInstalled, createApp, type AppRow } from "./lib/apps-store";
// Owner's disabled built-ins/features (App Store → Apps/Features toggles). os-root
// filters the manifest by it so disabled apps/features leave the shell entirely.
export { useDisabledIds } from "./lib/enabled-store";
// Shared glyph helpers (create-app icon picker/preview reuse the App Store set).
export { GLYPH_KEYS, glyphIcon } from "./lib/glyph";
