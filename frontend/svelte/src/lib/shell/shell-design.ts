import type { ChromeProfile } from "./chrome-profile.ts";

export type ShellFamily = "apple" | "fluent" | "material" | "dashboard";
export type ShellDensity = "comfortable" | "compact" | "dense";
export type MobileNavMode = "none" | "ios" | "android";
export type SettingsNavMode =
  | "macos-sidebar"
  | "windows-rail"
  | "ios-stack"
  | "android-list"
  | "dashboard-tabs";
export type FilesPresentation =
  | "finder"
  | "explorer"
  | "ios-files"
  | "android-files"
  | "dashboard";

export type ShellDesignProfile = {
  readonly id: ChromeProfile;
  readonly family: ShellFamily;
  readonly density: ShellDensity;
  readonly mobileNavigation: MobileNavMode;
  readonly settingsNavigation: SettingsNavMode;
  readonly filesVariant: FilesPresentation;
  readonly windowed: boolean;
  readonly edgeToEdgeApps: readonly string[];
};

export type MobileNavSpec = {
  readonly title: string;
  readonly backLabel: string;
  readonly onBack: () => void;
};

export type PointerKind = "fine" | "coarse";

const EDGE_APPS = ["terminal", "editor", "workflows", "memory", "image-editor", "media-studio", "reel-editor", "camoufox", "n8n", "t3"] as const;

export const SHELL_DESIGN_PROFILES: Readonly<Record<ChromeProfile, ShellDesignProfile>> = {
  macos: {
    id: "macos",
    family: "apple",
    density: "compact",
    mobileNavigation: "none",
    settingsNavigation: "macos-sidebar",
    filesVariant: "finder",
    windowed: true,
    edgeToEdgeApps: EDGE_APPS,
  },
  windows: {
    id: "windows",
    family: "fluent",
    density: "compact",
    mobileNavigation: "none",
    settingsNavigation: "windows-rail",
    filesVariant: "explorer",
    windowed: true,
    edgeToEdgeApps: EDGE_APPS,
  },
  ios: {
    id: "ios",
    family: "apple",
    density: "comfortable",
    mobileNavigation: "ios",
    settingsNavigation: "ios-stack",
    filesVariant: "ios-files",
    windowed: false,
    edgeToEdgeApps: EDGE_APPS,
  },
  android: {
    id: "android",
    family: "material",
    density: "comfortable",
    mobileNavigation: "android",
    settingsNavigation: "android-list",
    filesVariant: "android-files",
    windowed: false,
    edgeToEdgeApps: EDGE_APPS,
  },
  dashboard: {
    id: "dashboard",
    family: "dashboard",
    density: "dense",
    mobileNavigation: "none",
    settingsNavigation: "dashboard-tabs",
    filesVariant: "dashboard",
    windowed: false,
    edgeToEdgeApps: EDGE_APPS,
  },
};

export function designProfileFor(chrome: ChromeProfile): ShellDesignProfile {
  return SHELL_DESIGN_PROFILES[chrome] ?? SHELL_DESIGN_PROFILES.macos;
}

export function detectPointerKind(): PointerKind {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "fine";
  return window.matchMedia("(pointer: coarse)").matches ? "coarse" : "fine";
}
