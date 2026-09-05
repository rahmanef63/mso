import type { ComponentType, CSSProperties } from "react";

/** The glyph contract <AppIcon> renders against — the subset of LucideProps it
 *  actually passes, so a plain component can stand in for a lucide icon. */
export type AppIconComponent = ComponentType<{
  className?: string;
  style?: CSSProperties;
  strokeWidth?: number;
}>;

export type WinId = string;

export type Rect = { x: number; y: number; w: number; h: number };

export type WindowState = {
  id: WinId;
  app: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  minimized: boolean;
  maximized: boolean;
  /** Saved rect for restore from maximize/snap. */
  prevRect?: Rect;
  /** The zone this window is snapped to. Kept so a shell switch (different
   *  chrome insets) can re-tile snapped/maximized windows into the new work
   *  area instead of leaving frozen geometry. Cleared on free move/resize. */
  snapZone?: SnapZone;
  /** Optional context handed to the app component (e.g. a file path to open). */
  payload?: unknown;
  /** Always-on-top: rendered above the regular stack (PiP-style). */
  pinned?: boolean;
  /** Virtual desktop this window lives on (default 1). */
  spaceId?: number;
  /** Tab group — members render as ONE tabbed frame (top-z member shows). */
  groupId?: string;
};

/** Props every app component receives. `payload` is whatever opened the window;
 * `winId` lets an app address its own window (e.g. register a close guard). */
export type AppProps = { payload?: unknown; winId?: string };

export type SnapZone =
  | "left" | "right" | "top"
  | "tl" | "tr" | "bl" | "br"
  // tiling presets: thirds (left/right ⅓ and ⅔ columns)
  | "l13" | "l23" | "r13" | "r23";

export type ShellState = {
  windows: Record<WinId, WindowState>;
  order: WinId[];
  focused: WinId | null;
  /** Active virtual desktop (Spaces) — windows on other spaces stay hidden. */
  activeSpace: number;
  launcherOpen: boolean;
  spotlightOpen: boolean;
  inspectorOpen: boolean;
  notificationCenterOpen: boolean;
};

/**
 * An OS app, contributed by a feature slice. os-shell never imports apps
 * directly — the app layer collects descriptors from each slice barrel and
 * passes them to <OsDesktop apps=… />. Open/closed: new app = new descriptor.
 */
export type AppDescriptor = {
  id: string;
  /** URL slug for deep-linking (`/files`); falls back to `id` when unset. */
  slug?: string;
  title: string;
  /** Any glyph component taking the props <AppIcon> passes. A LucideIcon satisfies
   *  it; so does a hand-written mark, which is how apps that wrap a THIRD-PARTY
   *  product (Hermes, OpenClaw, Camoufox) show that product's own logo instead of
   *  an approximate lucide glyph. */
  icon: AppIconComponent;
  /** CSS gradient for the glossy dock/launcher icon (os-rr style). */
  gradient: string;
  /** Render the icon edge-to-edge with no gradient tile, sheen or hairline. For a
   *  real brand mark, which already carries its own shape and colour — the tile
   *  treatment is for monochrome line glyphs and makes a logo look pasted on. */
  iconFill?: boolean;
  /** Lazy-loaded so a window only pulls its app bundle when opened. */
  load: () => Promise<{ default: ComponentType<AppProps> }>;
  defaultSize?: { w: number; h: number };
  /** Hide from the dock (still launchable via launcher). */
  noDock?: boolean;
  /** Pinned to the mobile dock / quick-shortcut set (consumer manifest decides
   *  — the generic shell never hardcodes project app ids). */
  pinned?: boolean;
  /** Allow several windows at once (e.g. Files); default = single instance. */
  multi?: boolean;

  /** macOS menu-bar menus contributed by THIS app when it's focused. Each menu
   *  is a top-bar dropdown (File / Edit / custom). When unset the shell shows the
   *  generic File/Edit/View defaults — so apps opt in to a richer menu bar. The
   *  same items power the iOS long-press quick-actions sheet. */
  menus?: AppMenu[];
};

/** A single menu-bar dropdown (e.g. "File") with its rows. */
export type AppMenu = { label: string; items: AppMenuItem[] };
/** A row in an app menu; `{ sep: true }` draws a divider. */
export type AppMenuItem =
  | { sep: true }
  | {
      sep?: false;
      label: string;
      /** Keyboard hint shown right-aligned (display only, e.g. "⌘S"). */
      shortcut?: string;
      onSelect?: () => void;
      disabled?: boolean;
    };

/** Serialisable slice of a window persisted to localStorage (no z/focus churn).
 *  Includes `payload`/`snapZone`/`prevRect` — `serialize()` keeps them so a
 *  deep-link path survives a reload and snapped windows re-tile after a shell
 *  switch; the restore (hydrateBoot) also dedupes a multi-app window by payload. */
export type PersistedWindow = Pick<
  WindowState,
  "id" | "app" | "title" | "x" | "y" | "w" | "h" | "minimized" | "maximized" | "pinned" | "spaceId" | "groupId" | "payload" | "snapZone" | "prevRect"
>;
