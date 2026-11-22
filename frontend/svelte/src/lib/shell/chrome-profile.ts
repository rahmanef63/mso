export type ChromeProfile = "macos" | "windows" | "dashboard" | "ios" | "android";
export type ChromeChoice = "auto" | ChromeProfile;

export type ChromeProfileMeta = {
  readonly id: ChromeProfile;
  readonly label: string;
  readonly description: string;
  readonly formFactor: "desktop" | "mobile";
};

export const MOBILE_VIEWPORT_MAX_PX = 640;

export const CHROME_PROFILES: readonly ChromeProfileMeta[] = [
  {
    id: "macos",
    label: "macOS",
    description: "Desktop bar and dock layout with traffic-light window controls.",
    formFactor: "desktop",
  },
  {
    id: "windows",
    label: "Windows",
    description: "Desktop taskbar layout with right-aligned window controls.",
    formFactor: "desktop",
  },
  {
    id: "dashboard",
    label: "Dashboard",
    description: "Tiled workspace layout with persistent navigation header.",
    formFactor: "desktop",
  },
  {
    id: "ios",
    label: "iOS",
    description: "Compact mobile sheet layout tuned for iOS viewports.",
    formFactor: "mobile",
  },
  {
    id: "android",
    label: "Android",
    description: "Compact mobile navigation layout tuned for Android viewports.",
    formFactor: "mobile",
  },
];

const PROFILE_IDS = new Set<string>(CHROME_PROFILES.map((entry) => entry.id));

export function isChromeProfile(value: unknown): value is ChromeProfile {
  return typeof value === "string" && PROFILE_IDS.has(value);
}

export function isChromeChoice(value: unknown): value is ChromeChoice {
  return value === "auto" || isChromeProfile(value);
}

export function resolveChromeProfile(
  choice: ChromeChoice,
  viewportWidth: number,
  userAgent = "",
): ChromeProfile {
  if (choice !== "auto") {
    return choice;
  }
  if (!Number.isFinite(viewportWidth) || viewportWidth > MOBILE_VIEWPORT_MAX_PX) {
    return "macos";
  }
  if (/android/i.test(userAgent)) {
    return "android";
  }
  if (/iphone|ipad|ipod|ios/i.test(userAgent)) {
    return "ios";
  }
  return "ios";
}
