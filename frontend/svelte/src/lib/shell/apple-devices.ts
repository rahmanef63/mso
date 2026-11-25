import type { ChromeChoice } from "./chrome-profile.ts";

export type AppleDeviceId = "ios" | "ipad" | "mac";
export type AppleDeviceMode = "auto" | AppleDeviceId;
export type AppleFormFactor = "phone" | "tablet" | "desktop";
export type AppleShellKind = "MobileShell" | "DesktopShell";
export type AppleFrameType = "bezel" | "window" | "none";

export type AppleFrameSpec = {
  readonly w: number;
  readonly h: number;
  readonly radius: number;
  readonly bezel: number;
};

export type AppleDeviceSpec = {
  readonly id: AppleDeviceId;
  readonly prop: "iPhone" | "iPad" | "Mac";
  readonly label: string;
  readonly os: string;
  readonly icon: string;
  readonly formFactor: AppleFormFactor;
  readonly shell: AppleShellKind;
  readonly frameType: AppleFrameType;
  readonly auto: boolean;
  readonly maxW: number;
  readonly frame: AppleFrameSpec | null;
};

export type AppleSwitchSegment = {
  readonly id: AppleDeviceMode;
  readonly label: string;
  readonly icon: string;
  readonly os: string;
};

export const APPLE_DEVICES: readonly AppleDeviceSpec[] = [
  {
    id: "ios",
    prop: "iPhone",
    label: "iPhone",
    os: "iOS",
    icon: "dev-iphone",
    formFactor: "phone",
    shell: "MobileShell",
    frameType: "bezel",
    auto: true,
    maxW: 760,
    frame: { w: 402, h: 844, radius: 52, bezel: 11 },
  },
  {
    id: "ipad",
    prop: "iPad",
    label: "iPad",
    os: "iPadOS",
    icon: "dev-ipad",
    formFactor: "tablet",
    shell: "DesktopShell",
    frameType: "bezel",
    auto: true,
    maxW: 1200,
    frame: { w: 1024, h: 768, radius: 30, bezel: 13 },
  },
  {
    id: "mac",
    prop: "Mac",
    label: "Mac",
    os: "macOS",
    icon: "dev-mac",
    formFactor: "desktop",
    shell: "DesktopShell",
    frameType: "window",
    auto: true,
    maxW: Number.POSITIVE_INFINITY,
    frame: null,
  },
] as const;

export const APPLE_DEVICE_BY_ID: Readonly<Record<AppleDeviceId, AppleDeviceSpec>> = {
  ios: APPLE_DEVICES[0],
  ipad: APPLE_DEVICES[1],
  mac: APPLE_DEVICES[2],
};

const BY_PROP: Readonly<Record<string, AppleDeviceSpec>> = {
  iPhone: APPLE_DEVICES[0],
  iPad: APPLE_DEVICES[1],
  Mac: APPLE_DEVICES[2],
};

export function appleModeFromProp(prop?: string | null): AppleDeviceMode {
  if (!prop || prop === "auto") {
    return "auto";
  }
  const spec = BY_PROP[prop];
  return spec ? spec.id : "auto";
}

export function resolveAppleDevice(viewportWidth: number): AppleDeviceId {
  const autoDevices = APPLE_DEVICES.filter((d) => d.auto).sort((a, b) => a.maxW - b.maxW);
  for (const device of autoDevices) {
    if (viewportWidth < device.maxW) {
      return device.id;
    }
  }
  const fallback = autoDevices[autoDevices.length - 1] ?? APPLE_DEVICES[APPLE_DEVICES.length - 1];
  return fallback.id;
}

export function appleSwitchSegments(): readonly AppleSwitchSegment[] {
  return [
    { id: "auto", label: "Auto", icon: "dev-auto", os: "Adaptive" },
    ...APPLE_DEVICES.map((d) => ({
      id: d.id,
      label: d.label,
      icon: d.icon,
      os: d.os,
    })),
  ];
}

export function appleDeviceToChrome(id: AppleDeviceMode): ChromeChoice {
  if (id === "auto") return "auto";
  if (id === "ios" || id === "ipad") return "ios";
  return "macos";
}
