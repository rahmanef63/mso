// MSO's shell manifest — the mso-specific config that drives the generic
// AppShell. This is the ONE place brand + the built-in app set + shell features
// are declared; appshell core imports none of it. Runtime-installed apps are
// merged on top in os-root (they come from a hook, not static config).
import type { AppDescriptor, Brand, FeatureDescriptor } from "@/features/appshell";
import { DEFAULT_FEATURES } from "@/features/appshell";
import { filesManagerApp } from "@/features/files-manager";
import { camoufoxBrowserApp } from "@/features/camoufox-browser";
import { codeEditorApp } from "@/features/code-editor";
import { osTerminalApp, claudeCodeApp } from "@/features/os-terminal";
import { mediaStudioApp } from "@/features/media-studio";
import { reelEditorApp } from "@/features/reel-editor";
import { mediaViewerApp } from "@/features/media-viewer";
import { appStoreApp } from "@/features/app-store";
import { createAppApp } from "@/features/create-app";
import { systemMonitorApp } from "@/features/system-monitor";
import { assistantApp } from "@/features/assistant";
import { hermesApp, nineRouterApp, openclawApp } from "@/features/managed-apps";
import { osSettingsApp } from "@/features/os-settings";
import { quicklinksApp } from "@/features/quicklinks";
import { docsApp } from "@/features/docs";
import { cloudflareApp, dokployApp } from "@/features/infrastructure";
import { themeQuickPickerFeature } from "./theme-quick-picker";
import { APP_MARKS } from "./brand-marks";

export const TOPSIDE_BRAND: Brand = {
  name: "MSO",
  logo: "M",
  idleAppName: "Finder",
};

// Preserve the historical localStorage namespace so existing saved layouts
// aren't orphaned (the generic appshell default is "appshell:layout").
export const TOPSIDE_PERSIST_KEY = "mso:layout";

// Short URL slug per app for deep-linking (`/files`), assigned here so the app
// slices stay URL-agnostic. Falls back to the app id when unmapped.
const withSlug = (app: AppDescriptor, slug: string): AppDescriptor => ({ ...app, slug });
// Pinned = the mobile dock / quick-shortcut set (appshell stays id-agnostic).
const pin = (app: AppDescriptor): AppDescriptor => ({ ...app, pinned: true });
// App artwork is a consumer concern. Built-ins get tiny generated WebP artwork
// here while each feature slice keeps a lightweight Lucide fallback for reuse
// outside MSO. `iconFill` tells AppIcon the WebP already owns its tile treatment.
const withArtwork = (app: AppDescriptor): AppDescriptor => {
  const icon = APP_MARKS[app.id];
  return icon ? { ...app, icon, iconFill: true } : app;
};

// Built-in apps (dock order; media-viewer is noDock). Runtime apps append.
export const BUILTIN_APPS: AppDescriptor[] = [
  pin(withSlug(withArtwork(filesManagerApp), "files")),
  pin(withSlug(withArtwork(camoufoxBrowserApp), "browser")),
  withSlug(withArtwork(codeEditorApp), "code"),
  pin(withSlug(withArtwork(osTerminalApp), "terminal")),
  pin(withSlug(withArtwork(claudeCodeApp), "claude")),
  withSlug(withArtwork(mediaStudioApp), "studio"),
  withSlug(withArtwork(reelEditorApp), "reel"),
  withSlug(withArtwork(mediaViewerApp), "viewer"),
  withSlug(withArtwork(appStoreApp), "store"),
  withSlug(withArtwork(createAppApp), "create"),
  pin(withSlug(withArtwork(systemMonitorApp), "monitor")),
  withSlug(withArtwork(assistantApp), "assistant"),
  withSlug(withArtwork(hermesApp), "hermes"),
  withSlug(withArtwork(openclawApp), "openclaw"),
  withSlug(withArtwork(nineRouterApp), "9router"),
  withSlug(withArtwork(dokployApp), "dokploy"),
  withSlug(withArtwork(cloudflareApp), "cloudflare"),
  withSlug(withArtwork(quicklinksApp), "links"),
  // Docs is deliberately dockable, not noDock: for a signed-out visitor it is the
  // only app that explains what they are looking at and how to get their own.
  withSlug(withArtwork(docsApp), "docs"),
  pin(withSlug(withArtwork(osSettingsApp), "settings")),
];

// Shell features — the generic brand-free set now lives INSIDE the appshell
// slice (appshell/features/*) and ships as one bundle, DEFAULT_FEATURES. mso
// uses them verbatim; trim/extend by spreading ([...DEFAULT_FEATURES, …]). Each
// mounts into a named slot (overlay/rightPanel/notifications/topPill/
// controlCenter/today), so a feature absent from the array just doesn't render.
// Settings stays the `os-settings` app (its own slice). mso adds one consumer
// feature: a compact theme-preset switcher in the menu-bar status cluster.
export const TOPSIDE_FEATURES: FeatureDescriptor[] = [...DEFAULT_FEATURES, themeQuickPickerFeature];
