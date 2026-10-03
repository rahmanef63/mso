import type { DeviceMode } from "../../../responsive/use-responsive";

/** iOS 27 tab-bar geometry we actually use.
 *  Kept from the kit measurements: 54/40 controls, 25pt and 32pt side insets,
 *  -8 tab overlap, 16pt split gap, 54 trailing capsule, 28pt symbol box,
 *  10/12 label, selected radius 100 and a 4pt-wider pill, iPad 44× content
 *  capsule with 4pt padding, 36pt row, 54×36 accessories.
 *  Discarded where they fight this shell: the 95/88pt frames (the home
 *  indicator already owns the bottom safe area), a second 4pt glass outset
 *  stacked on the 54pt control, the 491pt iPad artboard width (it is a sample
 *  tab count, not our dock), linear-burn on the app artwork, and plus-darker /
 *  plus-lighter on the selected pill (they sample the wallpaper and flatten
 *  the #EDEDED+#0088FF / #121212+#0091FF mix to gray). */
export const IOS_TAB = {
  expanded: 54,
  minimized: 40,
  glassPad: 4,
  symbol: 28,
  label: 10,
  labelLine: 12,
  overlap: -8,
  sideInset: 25,
  minimizedInset: 32,
  splitGap: 16,
  trailing: 54,
  selectedRadius: 100,
  selectedOutset: 2,
} as const;

export const IPAD_TAB = {
  height: 44,
  pad: 4,
  row: 36,
  accessoryWidth: 54,
  tabMin: 74,
  tabPadX: 18,
  tabPadY: 8,
  label: 15,
  labelLine: 20,
  tracking: -0.23,
  selectedRadius: 100,
} as const;

export type TabRole = "default" | "search" | "prominent";

export function isSplitRole(role: TabRole | undefined): boolean {
  return role === "search" || role === "prominent";
}

/** Search Role and Prominent Tab share one geometry: the marked tab leaves
 *  the main capsule and becomes the trailing capsule. Default stays one capsule. */
export function splitTabBar<T extends { role?: TabRole }>(tabs: T[]): { main: T[]; trailing: T | null } {
  const index = tabs.findIndex((tab) => isSplitRole(tab.role));
  if (index < 0) return { main: tabs, trailing: null };
  return { main: tabs.filter((_, i) => i !== index), trailing: tabs[index] ?? null };
}

/** Portrait tablets use the iPad bar. A forced phone preview stays the iPhone bar
 *  even when the desktop viewport is wide, because that preview is a phone frame. */
export function isIpadTabBar(device: DeviceMode, vw: number, isMobile: boolean): boolean {
  return isMobile && device !== "phone" && vw >= 768;
}
