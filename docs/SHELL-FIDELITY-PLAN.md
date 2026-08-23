# Shell Fidelity Plan — five lightweight, convincing OS clones

> **Historical design plan / backlog baseline.** The inventory below was written from the
> 2026-06-11 shell state and intentionally preserves its original gaps/budgets. Several
> phases subsequently shipped and the AppShell structure changed. Current shell contracts
> live in [`ARCHITECTURE.md`](./ARCHITECTURE.md), the per-shell design files under
> `frontend/slices/appshell/design/`, and current E2E tests. Treat unchecked items here as
> ideas to re-validate, not current bugs or promises.

> Goal: each shell (macOS · Windows 11 · iOS · Android · Dashboard) should feel
> *native to its OS* — visually and behaviourally — while the whole thing stays
> a lightweight web app. Builds on the multishell port (done; its plan doc was
> deleted 2026-07-30, recoverable at `git show bccd0b1:docs/MULTISHELL-PLAN.md`) and
> the 2026-06-11 fidelity inventory. Bugs referenced here are catalogued in
> `AUDIT-2026-06-11.md`.
>
> **Lightweight doctrine (hard constraints):**
> 1. **No new runtime dependencies.** Everything below is CSS + DOM + the
>    existing window store. No framer-motion, no html2canvas, no icon packs.
> 2. **CSS-first motion** — transforms/opacity only, honoring
>    `prefers-reduced-motion` + the existing `.reduce-motion` pref.
> 3. **System font stacks** (zero download) with an opt-in webfont toggle for
>    cross-OS authenticity (only Roboto is freely shippable).
> 4. **One shared window runtime** — shells stay skins over the same store;
>    fidelity comes from tokens + per-shell chrome, never store forks.
> 5. **Code-split shells** — a user on one shell shouldn't download the other
>    four chromes (today all 5 are eager in the main bundle).

## 0. Current state (inventory summary)

| Shell | Own LOC | Has | Missing (headline) |
|---|---|---|---|
| macOS | ~1,200 | menu bar+menus, magnifying dock, Launchpad, Spotlight, Mission Ctrl, ⌘Tab, NC+calendar, window tabs, Spaces, snap | window lifecycle animation, live previews, top-edge resize, dock pinning/bounce, Spaces UI, desktop Control Center |
| Windows | 375 | centered taskbar+underlines, Start w/ search, Snap Assist, Win caption variant, Task View | per-app grouping, hover previews, pinned apps, tray, Alt+Tab, Quick Settings/calendar flyouts, snap-layouts popup, Mica tint |
| iOS | ~1,120 | 3-page home, App Library, live-preview switcher, split NC/CC pull-down, Dynamic Island, home indicator gestures, long-press sheet | zoom-from-icon open/close, status bar cluster, edit/wiggle mode, folders/widgets on grid, "Done" header is non-iOS |
| Android | 314 | clock home, drawer w/ search, recents deck, 3-button nav, CC pull-down | status bar, **notification shade (log unreachable!)**, ripple, back-stack, gesture nav, dynamic color, live previews |
| Dashboard | 280 | sidebar+running list, breadcrumb, stats home | own identity spec; wallpaper hidden by opaque root; no notification surface |

Key structural facts: **no per-shell token layer** (all shells share one
`--radius`/`--blur`/font; per-shell looks are inline classNames), **no motion
token scale** (the `cubic-bezier(.2,.8,.2,1)` OS-ease is copy-pasted with
5 different durations), **zero window open/close/minimize animation**, **all
shells eager-bundled**, z-index is an ad-hoc 23-value inline ladder.

---

## 1. Shared infrastructure first (the multipliers)

Do these before any per-shell work — every shell gets better at once.

### 1.1 Per-shell design tokens (`data-shell` attribute)
`Surface` (`appshell/components/desktop.tsx`) sets
`data-shell="macos|windows|ios|android|dashboard"` on its root. `globals.css`
gains a token block per shell; shared chrome consumes only the vars:

```css
[data-shell] {
  --shell-font: var(--font-ui);
  --shell-radius-win: var(--radius-win); /* window corners */
  --shell-radius-ui: var(--radius);      /* menus, popovers, tiles */
  --shell-blur: var(--blur);
  --shell-ease: cubic-bezier(.2,.8,.2,1);
  --shell-dur-fast: 150ms; --shell-dur: 250ms; --shell-dur-slow: 350ms;
  --shell-icon-radius: 22%;              /* app icon mask */
}
[data-shell="windows"] { --shell-radius-win: 8px; --shell-radius-ui: 4px;
  --shell-ease: cubic-bezier(0,0,0,1); --shell-dur: 250ms; }
[data-shell="android"] { --shell-ease: cubic-bezier(.2,0,0,1);
  --shell-dur: 300ms; --shell-icon-radius: 50%; }
```

Then sweep the inline constants into the vars: `window.tsx`'s
`rounded-md`-vs-`rounded-[var(--radius-win)]` fork becomes one
`rounded-[var(--shell-radius-win)]`; the five copy-pasted `appOpen` durations
become `var(--shell-dur) var(--shell-ease)`. Theme presets keep working — they
override the base vars, shells override the shell vars.

### 1.2 Motion system + window lifecycle animation
One implementation in `window.tsx` + `lib/store.ts` covers macOS *and*
Windows:

- **Open**: mount with `scale(.97) opacity-0 → none` over
  `--shell-dur-fast`/`--shell-ease` (both OSes do a subtle scale-fade).
- **Close/minimize**: needs a leaving phase — add a transient
  `win.leaving: "close" | "minimize"` store flag; `closeWindow`/
  `minimizeWindow` set it, the Window component plays the transform and
  commits the real store action on `transitionend` (with a 400 ms safety
  timeout). Minimize animates `transform: translate(dx,dy) scale(.1)` toward
  the dock icon / taskbar button rect (macOS "Scale effect" — the real,
  user-selectable macOS option; genie is not worth the cost). Dock exposes
  `getIconRect(appId)` via a small registry ref; taskbar likewise.
- **Maximize/snap/restore**: animate via a 180 ms transition on
  top/left/width/height *only during the commit* (toggle a class, drop it on
  transitionend) so drag stays rAF-direct.
- Honor `.reduce-motion`: all of the above gated by one
  `motion-safe:` style or the existing pref class.

### 1.3 Authentic font stacks (zero-cost)
```css
[data-shell="macos"], [data-shell="ios"] { --shell-font:
  -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", var(--font-ui); }
[data-shell="windows"] { --shell-font:
  "Segoe UI Variable Text", "Segoe UI", system-ui, var(--font-ui); }
[data-shell="android"] { --shell-font:
  Roboto, "Google Sans Text", system-ui, var(--font-ui); }
```
On the matching host OS this is pixel-authentic for free. Cross-OS: only
Roboto is legally shippable — add it to the existing preset webfont pipeline
(`lib/appearance/presets/fonts.ts`) as an opt-in "Authentic fonts" toggle in
Settings → Appearance. Do **not** ship SF/Segoe lookalikes by default (weight).

### 1.4 Code-split the shells
`registerShell()` keeps metadata eager (Settings pickers + palette commands
need id/label/icon at module load) but `render` becomes a thin loader
component using the **window-content loader pattern** (`useState`/`useEffect`
import — NOT Suspense, per the documented store-sync rule):

```ts
registerShell({ id: "windows", ..., render: lazyShell(() => import("./windows-chrome")) });
```
Warm the chunk on Settings-picker hover (same trick as dock hover). Mobile
shells first (~1.4k LOC never used on desktop unless previewed). The shared
window runtime stays eager.

### 1.5 One window-preview primitive (`<WindowPreview win scale>`)
Four surfaces need it: Mission Control cards, Windows taskbar hover +
Snap Assist, Android recents, iOS switcher. Today: gradient stand-ins in
three places and (worse) **live `WindowContent` mounts in the iOS switcher**
(double PTY/screencast sessions — audit P1). Implementation without
dependencies: keep ONE live scaled render *only for the focused/visible app*,
and for background windows show a **snapshot card** — gradient + icon + title
+ the window's last-known size silhouette. Optional later upgrade: paint a
real snapshot by `drawImage`-ing `<canvas>`/`<img>`/`<video>` descendants into
a capture canvas on blur (works for terminal/browser/editors, which are
canvas/img-heavy; DOM-only apps keep the silhouette). The primitive decides;
surfaces just consume.

### 1.6 z-index ladder → tokens
23 ad-hoc values today; context menu (z-201) sits *under* the dock (z-880) —
a live bug. Define `--z-window/-chrome/-overlay/-menu/-system` (10/800/900/
950/9500), sweep, and the context-menu bug disappears structurally.

### 1.7 Cheap fixes that block fidelity
- `.dark .wp-material` dead selector (`globals.css:190`) → `[data-theme="dark"]
  .wp-material` (Android dark wallpaper currently can't activate).
- Dashboard root `bg-background` opaque → its registered `wp-graphite`
  wallpaper is never visible (`dashboard-shell.tsx:70`).
- Phone-frame escapes: Control Center (Radix Sheet portal) + toasts render
  `fixed` to body — portal them into the frame container on framed previews.

---

## 2. macOS shell

**Identity targets** (reference: Sonoma/Sequoia): window radius 10 px, menu
bar 24–30 px (current 30 ✓), traffic lights 12 px (✓), big soft window shadow
(✓ via `--shadow-win`), vibrancy = blur 30 px + saturate 180 % (✓ `.glass`),
ease ≈ `cubic-bezier(.32,.72,0,1)`, SF Pro stack (§1.3).

Priority order:

1. **Window lifecycle animation** (§1.2) — the single biggest "feels like a
   Mac" win. Scale-to-dock minimize with the dock icon as target.
2. **Mission Control upgrade** (`window-overview.tsx`): `<WindowPreview>`
   cards (§1.5) + a **Spaces strip** along the top (Spaces already exist in
   `lib/spaces.ts`, palette-only today) with drag-window-to-space.
3. **Dock behaviours**: minimize-into-dock target (§1.2 gives the rect);
   running-app bounce on launch (one keyframe, `animation-iteration-count`
   until ready); drag-to-reorder + user pinning (persist order in
   localStorage — manifest order stays the default).
4. **Window chrome completeness**: top-edge + top-corner resize handles
   (`window.tsx:117-120` currently L/R/bottom only); double-click title zoom
   exists ✓; Option-click traffic lights → minimize-all/zoom-all variants.
5. **Menu bar**: wire "About {app}" (manifest `about` text in a dialog) and
   "Preferences…" (open the app's settings window/payload); add **desktop
   Control Center** — the CC feature already exists, mount it from a menu-bar
   status icon into a popover instead of mobile-only.
6. **Notification Center**: group by app with collapse stacks (data is
   already in the toast log).

Skip (cost > value): genie effect, desktop file icons, real fullscreen API,
sounds.

## 3. Windows 11 shell

**Identity targets**: window radius 8 px, taskbar 48 px (✓), Mica ≈ wallpaper
tint + heavy blur on the bar, acrylic flyouts, Segoe stack (§1.3), decelerate
ease `cubic-bezier(0,0,0,1)`, durations 167/250/333 ms, close-hover
`#C42B1C`-class destructive (✓ via token).

1. **Taskbar grouping**: one button per *app* (badge count for >1 window),
   hover → **preview flyout** listing that app's windows via
   `<WindowPreview>` (§1.5); click cycles, middle-click new window for
   `multi` apps. Pinned (non-running) apps from the same persisted-pin store
   as the macOS dock (§2.3 — share it).
2. **Snap layouts popup**: hover the maximize caption button → 6-zone layout
   picker (the quadrant zones already exist in `store-geometry`; only
   left/right pulse today). Hook: `WinCaption` in `window.tsx:140`.
3. **Alt+Tab**: bind Alt (in addition to ⌘/Ctrl) in `app-switcher.tsx:40`,
   render the Win11 grid variant (larger cards, app icon + title) when
   `data-shell="windows"`.
4. **Quick Settings + calendar flyouts**: tray click → acrylic Quick Settings
   (reuse Control Center tiles feature in a Win11 skin); clock click →
   calendar + notifications (the macOS NC calendar already exists — reskin,
   right-anchored above the tray).
5. **Mica approximation**: taskbar/start get `backdrop-blur-2xl` over a
   desaturated wallpaper tint (one `::before` sampling the `.wp-win11`
   gradient — pure CSS); accent color from the theme token (✓ already).
6. **System tray**: overflow area with the menu-bar status `<Slot>` content
   (CPU chip etc. already exist as slot items).
7. Window open/close/minimize animation comes free from §1.2.

Skip: widgets board, virtual-desktop Win+Tab timeline (Task View + Spaces
cover it), live taskbar thumbnails of video.

## 4. iOS shell

**Identity targets**: icon squircle 22 % (✓), home indicator 134×5 (✓), spring
feel via CSS `linear()` approximations, SF stack, status bar with time left /
indicators right, app-open zoom from the tapped icon.

1. **Zoom-from-icon open/close** — the defining iOS gesture. On launch,
   capture the tapped icon's rect; animate a rounded-rect proxy from icon
   rect → fullscreen (transform scale/translate, `--shell-dur-slow`,
   spring-ish `linear(0, .6 30%, 1.05 70%, 1)`), then swap in the app pane;
   reverse on home gesture (pane shrinks back to the icon). Hook:
   `mobile-shell.tsx:122-139` `launch()`/`goHome()` + icon rect registry
   (same pattern as §1.2's dock rects).
2. **Drop the "Done" header** — real iOS apps sit edge-to-edge under the
   status bar; exit is gesture-only. The header (`mobile-shell.tsx:127-139`)
   becomes opt-in chrome for apps that declare no safe-area handling;
   default = status strip overlay + home indicator only.
3. **Status bar cluster**: time left (✓ exists), right side gets SVG
   signal/Wi-Fi/battery glyphs driven by *real* data where available
   (Network Information API / Battery API behind feature checks, static
   glyphs otherwise) — matches the "real toggles only" doctrine.
4. **Home-screen edit mode**: long-press empty area → wiggle mode
   (±1.5° rotate keyframe, stagger via `animation-delay: calc(var(--i) *
   -80ms)`), drag-to-reorder (the grid is already a flat array — persist
   order), drop-on-icon → folder. Widgets (Today cards) placeable on grid
   pages.
5. **App Library categories from the manifest** — add
   `AppDescriptor.category`; delete the hardcoded id→category map
   (`mobile-app-library.tsx:12-26`) so runtime-installed apps file correctly.
6. **Switcher**: replace per-card live mounts with §1.5 previews (also fixes
   the double-session audit P1); stack cards with slight parallax
   (`scroll-timeline` where supported, static offsets otherwise).
7. **Pull-down Spotlight on the grid** (short pull = Spotlight, edge pulls
   stay NC/CC — matches iOS 17) and **lock-screen notifications** (the toast
   log is already there).
8. **Haptics**: `navigator.vibrate(10)` on long-press/toggles (Android
   browsers only; iOS Safari ignores — fine, it's progressive).

Skip: Dynamic Island idle animations beyond live activities (exists ✓),
parallax wallpaper, widgets stacks.

## 5. Android shell (largest fidelity gap)

**Identity targets**: Material 3 — status bar, two-stage notification shade,
ripple, dynamic color, Roboto, emphasized ease `cubic-bezier(.2,0,0,1)`
300–400 ms, circular icon mask.

1. **Status bar** (top, always): clock left, battery/network glyphs right —
   currently *nothing* renders at the top; this is the cheapest big win.
   Reuse the iOS status strip with `data-shell` styling.
2. **Notification shade** — the audit found the notification log is
   **unreachable in this shell**. Pull-down stage 1: notification cards
   (from `lib/toast` log, same source the iOS NC reads) + 6 Quick-Settings
   chips; pull further (or second pull) stage 2: full QS tile grid (reuse
   Control Center tiles in Material skin) + brightness-style slider row.
   Hook: `android-shell.tsx:83-85` currently opens CC directly — insert the
   shade between.
3. **Ripple**: one CSS utility (`.ripple` — `::after` radial scale from
   pointer coords set via `--x/--y` custom props in a 10-line pointerdown
   helper) applied to grid icons, drawer rows, QS tiles, nav buttons.
4. **App drawer gesture**: swipe-up from home opens the drawer with a
   slide+fade (a `usePullUp` mirror of `use-pull-down.ts`); keep the handle
   button as fallback.
5. **Back as a real back-stack**: a tiny `backBus` — apps may register a
   handler (`useBackHandler(fn)` capability); NavBar back pops app-internal
   state first (Files → parent dir, browser → history back), else goes home.
   This is also the seam for **predictive back** later (scale the pane to
   ~90 % while the gesture is held).
6. **Recents**: §1.5 previews instead of gradient tint; cards at ~70 % scale,
   app icon + label header (already close).
7. **Gesture-nav option**: settings toggle 3-button ↔ gesture pill (reuse the
   iOS `HomeIndicator`, restyled); Android users expect the pill now.
8. **Dynamic color (Material You)**: derive accent from the wallpaper —
   for the built-in gradient wallpapers ship a precomputed accent per
   `.wp-*`; for custom wallpapers sample the image once on selection
   (tiny canvas average → hue rotate the accent var). Cheap, no library.
9. **Home polish**: At-a-Glance row (date + a stat from `useSystemStats`),
   icon mask `--shell-icon-radius: 50%`, multi-page grid with the same
   pager as iOS, Roboto stack.

## 6. Dashboard shell

Not an OS clone — give it an explicit identity: **ops console** (Grafana/
Vercel-dashboard energy). Spec:

1. Fix the wallpaper-hidden bug (§1.7); use a dimmed `wp-graphite` under a
   translucent content plane.
2. **Notification surface**: bell button in the breadcrumb header → the
   shared NC panel (log is currently unreachable here too).
3. **Widget-grid home**: the stats cards become draggable/arrangeable tiles
   (persist layout) — reuse `shell-widgets` registry so apps can contribute
   tiles (Terminal "last command", Files "recent", monitor sparklines).
4. **Split view**: optional second pane (master-detail) — open-in-split from
   the Running list; the window store already holds multiple windows, the
   shell just renders two `AppHost`s.
5. Make it available on mobile too (it's the one shell that genuinely works
   as a phone dashboard) — add to `MOBILE_IDS` with a stacked layout.
6. Keyboard-first: sidebar arrow-key nav, `g h` style go-shortcuts, visible
   ⌘K hint in the header.

## 7. Phasing & budget

| Phase | Scope | Exit criteria |
|---|---|---|
| **A — Foundations** | §1.1 tokens + §1.3 fonts + §1.6 z-ladder + §1.7 fixes | shells visually unchanged except fonts/radii; all inline durations/radii gone |
| **B — Motion** | §1.2 window lifecycle + per-shell ease/durations | open/close/minimize animate on macOS+Windows; reduce-motion honored |
| **C — Previews** | §1.5 primitive → Mission Ctrl, taskbar hover, Snap Assist, recents, iOS switcher | no live `WindowContent` in any switcher; double-session bug gone |
| **D — Per-shell top-3** | macOS: dock anims+Spaces strip · Win: grouping+snap popup+Alt-Tab · iOS: zoom-open+status bar · Android: status bar+shade+ripple · Dash: wallpaper+bell | each shell passes its "squint test" |
| **E — Deep cuts** | iOS edit mode/folders · Win flyouts+Mica · Android back-bus+dynamic color · Dash widget grid | parity with this doc |
| **F — Lightweight proof** | §1.4 code-split + bundle audit | each non-default shell chunk lazy; main bundle delta from this plan ≤ ~10 KB gz (it's CSS+small TSX) |

Budget rules: no new deps (hard); every animation transform/opacity-only;
fonts opt-in beyond system stacks; verify each phase on demo `:4006`
(desktop via os-browser at 1280, mobile Playwright at 390, per CLAUDE.md).

## 8. Authenticity cheat sheet (for implementers)

| | macOS | Windows 11 | iOS | Android (M3) |
|---|---|---|---|---|
| Window/sheet radius | 10 px | 8 px | 38–47 px screen, 10–16 px sheets | 28 px sheets, 16 px cards |
| Bar heights | menu 24–30 px, dock ~64+ | taskbar 48 px | status ~47–54 px, indicator 34 px reserve | status 24–28, nav 48 (3-btn) / 24 (pill) |
| Ease | `cubic-bezier(.32,.72,0,1)` | `cubic-bezier(0,0,0,1)` | springs — approx `linear(0,.6 30%,1.05 70%,1)` | `cubic-bezier(.2,0,0,1)` emphasized |
| Durations | 250–350 ms | 167/250/333 ms | 350–500 ms | 300–400 ms |
| Material | blur 30 + saturate 180 % vibrancy | Mica (wallpaper tint) bars, acrylic flyouts | heavy blur sheets (28–40 px) | tonal surfaces, less blur |
| Font | SF Pro (`-apple-system`) | Segoe UI Variable | SF Pro | Roboto / Google Sans |
| Icon mask | squircle 22 % | rounded 4–8 px | squircle 22 % | circle 50 % |
| Close affordance | traffic lights left | caption right, close hover red | none (gesture) | none (gesture/back) |
| Signature behaviours | dock magnify ✓, scale-minimize, ⌘-menus | snap layouts, taskbar grouping, Alt-Tab | zoom-from-icon, rubber-band, gestures | ripple, shade 2-stage, predictive back |
