// Cross-app behavioural config (single source of truth) for Apple OS shell
// chrome geometry, motion timing, and z-index ordering.

export const APPLE_MOTION = {
  base: ".42s",
  fast: ".2s",
} as const;

export type AppleMotionConfig = typeof APPLE_MOTION;

export const APPLE_CHROME = {
  macToolbar: 52,
  macMenuBar: 26,
  phoneStatus: 44,
  phoneNav: 46,
  phoneTabBar: 92,
  phoneHomePad: 34,
  padStatus: 24,
  padToolbar: 48,
  padTopPad: 92,
  padHomePad: 34,
} as const;

export type AppleChromeConfig = typeof APPLE_CHROME;

export const APPLE_Z = {
  wall: 0,
  screen: 20,
  chrome: 30,
  statusOverlay: 40,
  dock: 55,
  menuBar: 60,
  menuDrop: 80,
  ctxCatcher: 90,
  ctx: 91,
  toast: 95,
  preview: 99,
} as const;

export type AppleZConfig = typeof APPLE_Z;
