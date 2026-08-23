import type { ShellId } from "../registry/shells";
import type { ShellDesignProfile } from "./types";

export const SHELL_DESIGN_PROFILES: Record<ShellId, ShellDesignProfile> = {
  ios: {
    id: "ios",
    family: "apple",
    density: "comfortable",
    mobileNavigation: "ios",
    settingsNavigation: "ios-stack",
    dialog: { mobile: "drawer-bottom", drawerHeightClass: "h-[92dvh] max-h-[92dvh]", drawerRadiusClass: "rounded-t-[24px]" },
    docsPath: "frontend/slices/appshell/design/ios/design.md",
  },
  android: {
    id: "android",
    family: "material",
    density: "comfortable",
    mobileNavigation: "android",
    settingsNavigation: "android-stack",
    dialog: { mobile: "drawer-bottom", drawerHeightClass: "h-[88dvh] max-h-[88dvh]", drawerRadiusClass: "rounded-t-[28px]" },
    docsPath: "frontend/slices/appshell/design/android/design.md",
  },
  macos: {
    id: "macos",
    family: "apple",
    density: "compact",
    mobileNavigation: "none",
    settingsNavigation: "macos-sidebar",
    dialog: { mobile: "dialog", drawerHeightClass: "", drawerRadiusClass: "" },
    docsPath: "frontend/slices/appshell/design/macos/design.md",
  },
  windows: {
    id: "windows",
    family: "fluent",
    density: "compact",
    mobileNavigation: "none",
    settingsNavigation: "windows-tabs",
    dialog: { mobile: "dialog", drawerHeightClass: "", drawerRadiusClass: "" },
    docsPath: "frontend/slices/appshell/design/windows/design.md",
  },
  dashboard: {
    id: "dashboard",
    family: "dashboard",
    density: "dense",
    mobileNavigation: "none",
    settingsNavigation: "dashboard-tabs",
    dialog: { mobile: "dialog", drawerHeightClass: "", drawerRadiusClass: "" },
    docsPath: "frontend/slices/appshell/design/dashboard/design.md",
  },
};

export function designProfileFor(id: ShellId): ShellDesignProfile {
  return SHELL_DESIGN_PROFILES[id];
}
