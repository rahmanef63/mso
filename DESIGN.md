# DESIGN.md

Dial: ENERGY 1 / RHYTHM 2 / MOTION 2

Design direction source for MSO (antislop R-37). Every value below is transcribed from
code that already ships in this repository. Each claim cites the file it came from. Where
the repository does not decide a field, the line says `UNSET` and names the missing
decision.

## 1. Identity

MSO is a mobile-first web cockpit for a headless VPS, reached from any browser. The audience
is the operator of that machine: one person who needs terminal, files, monitor, browser and
service control in one surface. The core visual metaphor is desktop OS chrome drawn over a
web app: windows, a dock or taskbar, a menu bar, Spotlight, Control Center, a lock screen.
The chrome is decoration in service of a utility. It is identity, not slop, because the
product states it explicitly in `CLAUDE.md`:

> Mobile-first web cockpit for a headless VPS, from any browser. Desktop-style UI
> metaphor over a vertical-slice stack; value is utility (terminal/files/monitor/
> browser), not an OS.

Five shell presentations are registered in `frontend/svelte/src/lib/shell/chrome-profile.ts`
(`ChromeProfile = "macos" | "windows" | "dashboard" | "ios" | "android"`), with per-shell
presentation profiles in `frontend/svelte/src/lib/shell/shell-design.ts`
(`SHELL_DESIGN_PROFILES`), independent desktop/mobile defaults `{ desktop: "macos", mobile: "ios" }`
in `frontend/svelte/src/lib/shell/shell-prefs-store.ts`, and shell chrome styling in
`frontend/svelte/src/lib/shell/os-chrome.css`. Shared behavior, per-shell presentation:
see `docs/FRONTEND-CONTRACT.md`.

## 2. Palette

### Default state: no preset

The shipped default is NOT a registry preset. `lib/appearance/types.ts:81` sets
`preset: null` in `TWEAK_DEFAULTS`, and `lib/appearance/presets/apply.ts:107` documents the
fallback as "back to the stock os-rr palette", which lives in `app/globals.css:9-113` and
is mirrored into the Svelte 5 static UI stylesheet `frontend/svelte/src/styles.css:1-106`.
So a user who has chosen nothing sees the stock tokens, not `modern-minimal`.

Stock core colors, read from `app/globals.css` and `frontend/svelte/src/styles.css`
(light at `:root`, dark at `[data-theme="dark"]` and `prefers-color-scheme: dark`):

| Token | Light | Dark | Source |
|---|---|---|---|
| `--background` / `--surface` | `#f4f4f7` | `#1b1b20` | `app/globals.css:67`, `:145`; `frontend/svelte/src/styles.css:3`, `:60` |
| `--foreground` / `--text` | `#1c1c1f` | `#f2f2f5` | `app/globals.css:46`, `:129`; `frontend/svelte/src/styles.css:12`, `:69` |
| `--primary` / `--accent` | `#1f6df0` | `#1f6df0` (`globals.css`), `#3b82f6` (`styles.css` dark) | `app/globals.css:43`, `:93`; `frontend/svelte/src/styles.css:15`, `:72` |
| `--accent` (hover tint) | `rgba(0, 0, 0, 0.05)` (via `--hover`) | `rgba(255, 255, 255, 0.08)` | `app/globals.css:99`, `:71`, `:149` |
| `--card` / `--window-bg` | `rgba(248, 248, 251, 0.86)` / `rgba(250, 250, 253, 0.95)` | `rgba(34, 34, 40, 0.82)` / `rgba(30, 30, 36, 0.9)` | `app/globals.css:66`, `:144`; `frontend/svelte/src/styles.css:6`, `:63` |
| `--border` | `rgba(0, 0, 0, 0.1)` / `rgba(0, 0, 0, 0.12)` | `rgba(255, 255, 255, 0.1)` / `rgba(255, 255, 255, 0.13)` | `app/globals.css:49`, `:132`; `frontend/svelte/src/styles.css:14`, `:71` |

`--accent` was darkened from `#2f7bf6` to `#1f6df0` on purpose so primary buttons clear
WCAG AA, per the comment at `app/globals.css:41-42`.

### Reference preset: modern-minimal

`modern-minimal` is registry item 0 (`lib/appearance/presets/registry-data.json:7`) and leads
the "Refined" group (`lib/appearance/presets/registry.ts:50-53`). It is selectable, not
default. Values as stored in the JSON:

| Token | Light | Dark |
|---|---|---|
| `--background` | `oklch(1.00 0 0)` | `oklch(0.20 0 0)` |
| `--foreground` | `oklch(0.32 0 0)` | `oklch(0.92 0 0)` |
| `--primary` | `oklch(0.56 0.19 259.81)` | `oklch(0.56 0.19 259.81)` |
| `--accent` | `oklch(0.95 0.03 236.82)` | `oklch(0.38 0.14 265.52)` |
| `--card` | `oklch(1.00 0 0)` | `oklch(0.27 0 0)` |
| `--border` | `oklch(0.93 0.01 264.53)` | `oklch(0.37 0 0)` |

Applied through `lib/appearance/presets/apply.ts`, which does not paint these hex or oklch
values directly. It derives chrome tokens (`--surface`, `--text`, `--glass-*`,
`--window-bg`, `--dock-bg`, and `--accent` from `primary`) with `color-mix`, so any color
format works (`lib/appearance/presets/apply.ts:15-48`).

### Core color count against R-29

Core set is 2 neutrals plus 1 accent: surface, text, `#1f6df0`. That respects the cap of
2 to 3 core colors plus one accent. Four semantic status colors sit outside that set and are
not decorative: `--destructive: #ff5f57`, `--success: #34c759`, `--warning: #ff9500`,
`--info: #0060df` (`app/globals.css:101-109`), each with an AA-tuned text variant
(`--destructive-text` / `--danger` is `#d70015` light and `#ff5f57` / `#fca5a5` dark in
`app/globals.css:104`, `:159` and `frontend/svelte/src/styles.css:17`, `:74`).
Stated plainly: the product ships 3 core colors, 4 semantic colors, and a registry of 36
presets that each carry their own full palette. 7 of those are hidden from the picker
(`lib/appearance/presets/registry.ts:44-47`, "Gimmicky presets hidden from the picker"), so
29 are selectable. Per-screen restraint is a picker choice, not an enforced limit.

## 3. Typography

Two families are real in chrome, coming from `frontend/svelte/src/styles.css:26-27` and
`app/globals.css:15-16`, overridden per preset by `lib/appearance/presets/apply.ts:81-84`:

| Token | Stock value | modern-minimal value |
|---|---|---|
| `--font-sans` / `--font-ui` | `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable Text", system-ui, sans-serif` | `Inter, sans-serif` then system fallback |
| `--font-mono` / `--font-mono-ui` | `ui-monospace, "SF Mono", Menlo, Consolas, monospace` | `JetBrains Mono, monospace` then mono fallback |
| `--font-serif` (registry only) | not defined in `styles.css` or `globals.css` | `Source Serif 4, serif` |

What each is for, based on actual usage:

- **Mono** is for terminal, code, paths, build SHA badges, and numeric readouts. In the
  Svelte 5 codebase (`frontend/svelte/src/`), `--font-mono` is used in terminal
  (`frontend/svelte/src/lib/terminal/`), code editor (`frontend/svelte/src/lib/editor/`),
  files (`frontend/svelte/src/lib/files/`), and build metadata (`frontend/svelte/src/lib/demo/DemoBanner.svelte`).
  It is not used for general chrome labels.
- **Sans** is the chrome and app-content face: `html, body { font-family: var(--font-sans) }`
  (`frontend/svelte/src/styles.css:110-116`), with per-shell platform stacks in
  `app/globals.css:291-295`, `:494-508` and `frontend/svelte/src/lib/shell/os-chrome.css`.
- **Serif** is declared by the preset registry (`modern-minimal`,
  `lib/appearance/presets/registry-data.json:22`) and loaded as a webfont by
  `lib/appearance/presets/fonts.ts`, but it appears in zero Svelte chrome or app surfaces:
  a repo search for `font-serif` in `frontend/svelte/src/` and `lib/` returns no UI usage.
  Purpose: `UNSET`. The missing decision is whether serif is a design element at all, or
  dead registry payload inherited from tweakcn. Owner decision, not an agent guess.

Tracking scale, from the preset `theme` block (`lib/appearance/presets/registry-data.json:24-28`):

```
--tracking-tighter: calc(var(--tracking-normal) - 0.05em)
--tracking-tight:   calc(var(--tracking-normal) - 0.025em)
--tracking-wide:    calc(var(--tracking-normal) + 0.025em)
--tracking-wider:   calc(var(--tracking-normal) + 0.05em)
--tracking-widest:  calc(var(--tracking-normal) + 0.1em)
```

`--tracking-normal` is `0em` in 35 of 36 presets; `supabase` sets `0.025em`. Uppercase
micro-labels in Svelte use explicit small tracking (`letter-spacing: 0.04em` on `dt` in
`frontend/svelte/src/styles.css:287`). No display face exists; scale jumps are size and
weight only.

## 4. Radius and elevation

Radius has one source in the token sheet: `--radius`, set in `app/globals.css:79` to
`0.625rem` and overridden per preset by `lib/appearance/presets/apply.ts:79-80`. Everything
derives from it (`app/globals.css:196-199`):

```
--radius-sm: calc(var(--radius) - 4px)
--radius-md: calc(var(--radius) - 2px)
--radius-lg: var(--radius)
--radius-xl: calc(var(--radius) + 4px)
--radius-win: calc(var(--radius) + 0.125rem)
--radius-icon: 22%   (a squircle proportion, not a corner radius)
```

Preset `radius` values across the registry span `0px` to `1.5rem`; `modern-minimal` is
`0.375rem`. Per-shell overrides exist in `app/globals.css:272-290` and
`frontend/svelte/src/lib/shell/os-chrome.css` so each shell reads native without forking
feature logic (macOS rounded windows, Windows crisper corners, Android circular/M3 shapes,
Dashboard flat tiled panels, iOS/Android mobile sheets).

Elevation is two named shadows, not a numeric scale (`frontend/svelte/src/styles.css:23-24`
light; `:53-54` and `:80-81` dark; mirrored in `app/globals.css:82-83`, `:153-154`):

```
--shadow-win: 0 0 0 0.5px rgba(0,0,0,0.18), 0 24px 60px -12px rgba(0,0,0,0.36), 0 8px 22px -10px rgba(0,0,0,0.24)
--shadow-pop: 0 0 0 0.5px rgba(0,0,0,0.16), 0 14px 38px -8px rgba(0,0,0,0.32)
```

Usage across `frontend/svelte/src/` stays structural (11 `--shadow-win` references and 8
`--shadow-pop` references for windows, menus, and modals). Depth is doing structural work
(a window sits above a desktop), not decoration. The preset registry also ships `shadow-2xs`
through `shadow-2xl`, but `lib/appearance/presets/apply.ts` injects only chrome tokens,
`--radius` and fonts, so those preset shadow values never reach the DOM.

Glass is a token, not a per-component choice: `--blur: 24px` in
`frontend/svelte/src/styles.css:25` (`30px` in `app/globals.css:75`), collapsing to
`--blur: 0px` and `backdrop-filter: none !important` under `:root[data-reduce-glass="true"]`
(`frontend/svelte/src/styles.css:290-305`).

## 5. The three dials

Dial: ENERGY 1 / RHYTHM 2 / MOTION 2

**ENERGY 1.** Color is neutral with one functional accent. Accent is reserved for selection,
focus, active controls, and primary actions (`--accent: #1f6df0` light / `#3b82f6` dark in
`frontend/svelte/src/styles.css:15`, `:72`), while high-contrast mode strengthens borders
and secondary text under `:root[data-high-contrast="true"]`
(`frontend/svelte/src/styles.css:307-338`). Dashboard remains a dense neutral graphite
surface without decorative gradients or glow.

**RHYTHM 2.** The five shells visibly differ in their own rhythm profiles rather than
sharing one scale. `frontend/svelte/src/lib/shell/shell-design.ts:40-91`
(`SHELL_DESIGN_PROFILES`) assigns `density: "comfortable"` to `ios` and `android`,
`"compact"` to `macos` and `windows`, and `"dense"` to `dashboard`, paired with per-shell
`settingsNavigation` (`macos-sidebar`, `windows-rail`, `ios-stack`, `android-list`,
`dashboard-tabs`) and `filesVariant` (`finder`, `explorer`, `ios-files`, `android-files`,
`dashboard`). Shared feature code, per-shell presentation.

**MOTION 2.** The shell animates state transitions, not ambience. Motion tokens in
`app/globals.css:286-289` and shell transitions in `frontend/svelte/src/lib/shell/os-chrome.css`
handle window open/close/minimize and mobile navigation without ambient loops. All
transitions collapse to `0.01ms` / `none` under `:root[data-reduced-motion="true"]` and
`@media (prefers-reduced-motion: reduce)` (`frontend/svelte/src/styles.css:340-352`).
Restrained functional motion: 2 and not 3.

## 6. What this product is NOT

- Not a marketing landing page. The root and catch-all routes serve the OS shell directly:
  `frontend/svelte/src/routes/+page.svelte` and `frontend/svelte/src/routes/[...slug]/+page.svelte`
  render `WorkspaceRoot.svelte`. The only other server HTML surfaces are OAuth consent
  (`app/oauth/authorize/route.ts`) and integration embeds (`app/integrations/`). There is no
  hero, pricing grid, or feature-tour route.
- No invented metrics or vanity counters. Operational numbers must come from the host
  (`/api/v1/sys/*` backed by `lib/host/` or Rust native metrics). When running in offline
  demo mode (`frontend/svelte/src/lib/demo/demo-adapter.ts`), `DemoBanner.svelte` explicitly
  labels the workspace as offline synthetic data so demo figures are never mistaken for live
  host telemetry.
- No testimonial, logo-wall, or pricing-tier sections. There is no billing surface and no
  third-party social proof in the shell; the value is a terminal, a file manager, a monitor,
  and a browser over one VPS.
- No gradient-as-brand. Backdrops are wallpapers (`frontend/svelte/src/lib/shell/wallpaper-store.ts`)
  with OS-matched fallbacks, and Dashboard renders no wallpaper photo so data panels stay
  readable; identity comes from chrome geometry, not a color wash.
- No second design system per feature. Cross-shell behavior is shared and only presentation
  varies via `SHELL_DESIGN_PROFILES` (`docs/FRONTEND-CONTRACT.md`).
- No decorative accent spread. Accent marks selection, focus, primary action, and status.

## 7. Known gaps

Honest list. None of these are fixed here; this file only records them.

1. **Glass count exceeds R-10.** `backdrop-filter` appears in 18 files (73 occurrences,
   including `-webkit-backdrop-filter` vendor lines and explicit `backdrop-filter: none`
   resets) under `frontend/svelte/src/`. R-10 caps glassmorphism at 1 to 2 simultaneous
   elements per screen. Most uses are transient or mutually exclusive shell tiers (dock,
   menu bar, lock screen, control center, context menus), and `:root[data-reduce-glass="true"]`
   disables all blur globally, but a per-screen simultaneous audit is still outstanding.
2. **Serif is unused.** Every preset declares `font-serif`, `lib/appearance/presets/fonts.ts`
   supports loading it, and no Svelte chrome or app surface consumes it. Either it becomes a
   real type role or the dead token should be dropped. Owner decision, recorded as `UNSET`
   in section 3.
3. **Preset elevation tokens are inert.** `shadow-*` values ship per preset in
   `lib/appearance/presets/registry-data.json` but `lib/appearance/presets/apply.ts` never
   injects them, so `--shadow-win` and `--shadow-pop` stay at their stock values under every
   preset. Current behavior is consistent (one elevation language), but the registry data is
   misleading.
4. **Palette count is picker-dependent.** The stock palette respects the 2 to 3 plus 1
   accent cap. All 36 registry entries ship a full palette (29 reachable from the picker),
   so restraint in any given screenshot depends on which preset is active, not on a gate.
5. **Dashboard lacks a fixed rhythm token.** Its presentation profile declares
   `density: "dense"`, but the spacing base in the preset registry is `0.25rem` for every
   preset and no dashboard-specific spacing token exists. Rhythm is convention in component
   styles, not a token.
6. **`--tracking-normal` is a single global.** Only `supabase` deviates (`0.025em`). The
   scale is a multiplier set, so tracking cannot be tuned per role (heading vs micro-label)
   without new tokens.

Enforced quality bar that is real and not aspirational: `node scripts/check-contrast.mjs`
fails the build on any WCAG AA (4.5:1) regression across 4 pairs (`text`, `muted text`,
`primary button`, `destructive`) in all 36 presets x 2 modes plus `app/globals.css`, and it
runs in `scripts/gates.sh` and `package.json` `check`. Current verified run: 36 presets x 2
modes + `app/globals.css` scanned, 0 failures light, 0 failures dark.
