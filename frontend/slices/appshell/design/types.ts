import type { ShellId } from "../registry/shells";

export type MobileNavigationStyle = "ios" | "android" | "none";
export type SettingsNavigationStyle = "ios-stack" | "android-stack" | "macos-sidebar" | "windows-tabs" | "dashboard-tabs";
export type DialogPresentation = "drawer-bottom" | "drawer-right" | "dialog";

/**
 * Presentation-only profile for one shell. No persistence, API, business logic,
 * or feature state belongs here. Feature slices keep one headless behavior model;
 * the active shell profile only selects chrome, density, and presentation.
 */
export type ShellDesignProfile = {
  id: ShellId;
  family: "apple" | "material" | "fluent" | "dashboard";
  density: "comfortable" | "compact" | "dense";
  mobileNavigation: MobileNavigationStyle;
  settingsNavigation: SettingsNavigationStyle;
  dialog: {
    mobile: DialogPresentation;
    drawerHeightClass: string;
    drawerRadiusClass: string;
  };
  docsPath: string;
};
