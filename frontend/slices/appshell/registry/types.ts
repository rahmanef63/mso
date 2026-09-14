import type { ComponentType, ReactNode } from "react";
import type { AppDescriptor } from "../lib/types";
import type { ShellCapabilities } from "./capabilities";

// Named regions a feature can mount into. The surfaces render <Slot region> at a
// fixed spot; which component fills it comes from the registered features. This
// is what makes the shell config-driven: add/remove a feature = manifest edit,
// no surface edit (open/closed).
export type SlotRegion =
  | "overlay" // full-screen overlays (e.g. command palette) — desktop + mobile
  | "rightPanel" // desktop right dock (e.g. inspector)
  | "notifications" // transient toast stack — desktop + mobile
  | "topPill" // mobile top-center status pill (e.g. dynamic island)
  | "controlCenter" // mobile pull-down control center
  | "menuBarStatus" // desktop menu-bar trailing cluster (e.g. control center)
  | "systemStatus" // shell-native server/session status: menu bar, taskbar, mobile status area
  | "today" // mobile widgets / today page
  | "desktopWidgets"; // desktop wallpaper-layer widget stack (behind windows)

/**
 * A pluggable shell feature (search, inspector, notifications, control-center,
 * widgets, settings…). Contributed by a `shell-*` slice via `defineFeature`.
 * appshell core never imports features — the consumer's manifest injects them.
 */
export type FeatureDescriptor = {
  id: string;
  /** Components mounted into named surface regions. */
  slots?: Partial<Record<SlotRegion, ComponentType>>;
  /** Optional context provider the feature needs wrapped around the shell. */
  provider?: ComponentType<{ children: ReactNode }>;
};

export type Brand = {
  name: string;
  /** Glyph/text/element for the menu-bar logo badge. */
  logo?: ReactNode;
  /** Menu-bar title when no app is focused (macOS shows "Finder"). */
  idleAppName?: string;
};

/** The whole-project config the shell is driven by. */
export type ShellManifest = {
  brand: Brand;
  apps: AppDescriptor[];
  features?: FeatureDescriptor[];
  /** localStorage namespace for persisted shell state (window layout). */
  persistKey?: string;
  /** Consumer-injected capabilities (appearance/host) — keeps the shell generic. */
  capabilities?: ShellCapabilities;
};

/** Identity helper — gives a feature its type + a stable authoring shape. */
export function defineFeature(feature: FeatureDescriptor): FeatureDescriptor {
  return feature;
}
