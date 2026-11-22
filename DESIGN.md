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

Five shell presentations are registered in `frontend/slices/appshell/registry/shells.tsx`
(`ShellId = "macos" | "windows" | "dashboard" | "ios" | "android"`), with defaults
`{ desktop: "macos", mobile: "ios" }`. Each shell has its own design contract under
`frontend/slices/appshell/design/<shell>/design.md`. Shared behavior, per-shell
presentation: see `frontend/slices/appshell/design/README.md`.

## 2. Palette

### Default state: no preset

The shipped default is NOT a registry preset. `lib/appearance/types.ts:80` sets
`preset: null` in `TWEAK_DEFAULTS`, and `lib/appearance/store.tsx:112-113` calls
`applyPreset(tweaks.preset)` only when a preset is set, otherwise `clearPreset()`. That
fallback is documented in `lib/appearance/presets/apply.ts:107` as "back to the stock os-rr
palette", which lives in `app/globals.css:9-113`. So a user who has chosen nothing sees the
stock tokens, not `modern-minimal`.

Stock core colors, read from `app/globals.css` (light at `:root`, dark at
`[data-theme="dark"]`, with the shadcn bridge resolved through `var()`):

| Token | Light | Dark | Source |
|---|---|---|---|
| `--background` | `#f4f4f7` (via `--surface`) | `#1b1b20` (via `--surface`) | `globals.css:67`, `:145`, `:87` |
| `--foreground` | `#1c1c1f` (via `--text`) | `#f2f2f5` (via `--text`) | `globals.css:46`, `:129`, `:88` |
| `--primary` | `#1f6df0` (via `--accent`) | `#1f6df0` (not redefined in dark) | `globals.css:43`, `:93` |
| `--accent` | `rgba(0, 0, 0, 0.05)` (via `--accent-bg` then `--hover`) | `rgba(255, 255, 255, 0.08)` | `globals.css:99`, `:71`, `:149` |
| `--card` | `rgba(248, 248, 251, 0.86)` (via `--window-bg`) | `rgba(34, 34, 40, 0.82)` | `globals.css:66`, `:144`, `:89` |
| `--border` | `rgba(0, 0, 0, 0.1)` (via `--sep`) | `rgba(255, 255, 255, 0.1)` | `globals.css:49`, `:132`, `:110` |

`--accent` was darkened from `#2f7bf6` to `#1f6df0` on purpose so primary buttons clear
WCAG AA, per the comment at `globals.css:41-42`.

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
format works (`apply.ts:15-48`).

### Core color count against R-29

Core set is 2 neutrals plus 1 accent: surface, text, `#1f6df0`. That respects the cap of
2 to 3 core colors plus one accent. Four semantic status colors sit outside that set and are
not decorative: `--destructive: #ff5f57`, `--success: #34c759`, `--warning: #ff9500`,
`--info: #0060df` (`globals.css:101-109`), each with an AA-tuned text variant
(`--destructive-text` is `#d70015` light and `#ff5f57` dark, `globals.css:104`, `:159`).
Stated plainly: the product ships 3 core colors, 4 semantic colors, and a registry of 36
presets that each carry their own full palette. 7 of those are hidden from the picker
(`lib/appearance/presets/registry.ts:44-47`, "Gimmicky presets hidden from the picker"), so
29 are selectable. Per-screen restraint is a picker choice, not an enforced limit.

## 3. Typography

Two families are real in chrome, and they come from one source: the appearance tokens in
`app/globals.css:15-16`, overridden per preset by `lib/appearance/presets/apply.ts:81-84`.

| Token | Stock value | modern-minimal value |
|---|---|---|
| `--font-ui` (maps to Tailwind `--font-sans`) | `var(--font-geist-sans)` then `-apple-system, BlinkMacSystemFont, system-ui, sans-serif` | `Inter, sans-serif` then Geist fallback |
| `--font-mono-ui` (maps to Tailwind `--font-mono`) | `var(--font-geist-mono)` then `ui-monospace, "SF Mono", Menlo, monospace` | `JetBrains Mono, monospace` then Geist Mono fallback |
| `--font-serif` (registry only) | not defined in `globals.css` | `Source Serif 4, serif` |

What each is for, based on actual usage:

- **Mono** is for terminal and code surfaces. The repo uses `font-mono` in 142 tsx
  occurrences, concentrated in `frontend/slices/os-terminal/` (PTY and exec terminals
  read the token directly at `pty-terminal.tsx:54`), `frontend/slices/files-manager/`
  (paths, sizes, zip names) and editor timelines. It is not used for chrome labels.
- **Sans** is the chrome and app-content face: `body { font-family: var(--font-ui) }`
  (`globals.css:222`), plus per-shell overrides that prepend a platform face, for example
  `-apple-system, ... "SF Pro Text"` for macos and ios, `"Segoe UI Variable Text"` for
  windows, `Roboto` for android (`globals.css:291-295`, `:494-508`).
- **Serif** is declared by the preset registry (`modern-minimal`,
  `registry-data.json:22`) and loaded as a webfont by
  `lib/appearance/presets/fonts.ts`, but it appears in zero chrome or app surfaces: a repo
  search for `font-serif` in `app/`, `frontend/`, `components/`, `lib/` returns no usage.
  Purpose: `UNSET`. The missing decision is whether serif is a design element at all, or
  dead registry payload inherited from tweakcn. Owner decision, not an agent guess.

Tracking scale, from the preset `theme` block (`registry-data.json:24-28`):

```
--tracking-tighter: calc(var(--tracking-normal) - 0.05em)
--tracking-tight:   calc(var(--tracking-normal) - 0.025em)
--tracking-wide:    calc(var(--tracking-normal) + 0.025em)
--tracking-wider:   calc(var(--tracking-normal) + 0.05em)
--tracking-widest:  calc(var(--tracking-normal) + 0.1em)
```

`--tracking-normal` is `0em` in 35 of 36 presets; `supabase` sets `0.025em`. Body
letter-spacing reads `var(--tracking-normal)` (`registry-data.json:12-16`). Real usage:
`tracking-tight` on headings (14 files), `tracking-wide`/`tracking-widest` on uppercase
micro-labels (42 files), for example
`frontend/slices/reel-editor/components/clip-ui.tsx:11` and `app/install/page.tsx:63`. No
display face exists; scale jumps are size and weight only.

## 4. Radius and elevation

Radius has one source: `--radius`, set in `app/globals.css:79` to `0.625rem` and overridden
per preset by `apply.ts:79-80`. Everything derives from it (`globals.css:196-199`):

```
--radius-sm: calc(var(--radius) - 4px)
--radius-md: calc(var(--radius) - 2px)
--radius-lg: var(--radius)
--radius-xl: calc(var(--radius) + 4px)
--radius-win: calc(var(--radius) + 0.125rem)
--radius-icon: 22%   (a squircle proportion, not a corner radius)
```

Preset `radius` values across the registry span `0px` to `1.5rem`; `modern-minimal` is
`0.375rem`. Per-shell overrides exist so a shell reads native without forking chrome
(`globals.css:272-290`): macos `--shell-radius-win: 10px`, windows `8px` window with `4px`
UI, android icon radius `50%`, dashboard dialogs `10px` (`globals.css:626-629`), and mobile
bottom sheets at `24px` ios / `28px` android (`globals.css:682-693`).

Elevation is two named shadows, not a numeric scale:

```
--shadow-win: 0 0 0 0.5px rgba(0,0,0,0.16), 0 24px 60px -12px rgba(0,0,0,0.42), 0 8px 22px -10px rgba(0,0,0,0.3)
--shadow-pop: 0 0 0 0.5px rgba(0,0,0,0.12), 0 14px 38px -8px rgba(0,0,0,0.32)
```

(light, `globals.css:82-83`; dark variants at `:153-154`). Usage is narrow: 2 files use
`var(--shadow-win)` and 4 use `var(--shadow-pop)`. Depth is doing structural work (a window
sits above a desktop), not decoration. The registry also ships `shadow-2xs` through
`shadow-2xl` per preset, but `apply.ts` injects only chrome tokens, `--radius` and fonts, so
those preset shadow values never reach the DOM. That is a fact about current behavior, not
a prescription.

Glass is a token, not a per-component choice: `--blur: 30px` (`globals.css:75`) with the
`.glass` helper applying `blur(var(--blur)) saturate(180%)` (`globals.css:236-240`), and
`--blur: 0px` under `.reduce-glass` (`globals.css:168`).

## 5. The three dials

Dial: ENERGY 1 / RHYTHM 2 / MOTION 2

**ENERGY 1.** Color is neutral with one functional accent. The accent is deliberately held
down: Mica tints the window surface with only 5% accent to keep `muted-foreground` at AA
(`globals.css:500-505`), and the Windows contract states "Accent is functional, not
decorative; use neutral surfaces for most content"
(`frontend/slices/appshell/design/windows/design.md`). The Dashboard contract says the same
in its own words: "Dense operational layout, neutral graphite surfaces"
(`design/dashboard/design.md`). No gradients as brand, no glow.

**RHYTHM 2.** The shells visibly differ in their own rhythm tokens rather than sharing one
scale. `frontend/slices/appshell/design/profiles.ts` assigns `density: "comfortable"` to
ios and android, `"compact"` to macos and windows, `"dense"` to dashboard. Measured row
heights follow: settings rows are `56px` android, `44px` windows, `42px` macos, `40px`
dashboard (`globals.css:633`, `:649`, `:662`, `:677`). Dashboard declares an 8px rhythm,
mobile shells use `24px` cards. Two shells, two rhythms, same feature code.

**MOTION 2.** The shell animates state transitions, not ambience. Tokens:
`--shell-dur-fast: 150ms`, `--shell-dur: 250ms`, `--shell-dur-slow: 340ms` with
`--shell-ease: cubic-bezier(0.2, 0.8, 0.2, 1)` (`globals.css:286-289`), tuned per shell
(`230ms` windows, `300ms`/`400ms` android with real M3 spring `linear()` curves,
`globals.css:498-539`). Window lifecycle has `winOpen`, `winClose`, `winMin`, geometry
`transition` on `.win-geo` for maximize and snap only, and mobile app open uses a 10px
translate rather than a scale (`globals.css:588-600`). All of it collapses to `1ms` under
`prefers-reduced-motion: reduce` (`globals.css:570-584`). That is restrained functional
motion, so 2 and not 3: nothing animates to show off.

Note for consistency: each shell's own `design.md` declares `ENERGY 1 / RHYTHM 1 / MOTION 1`
for that shell's chrome in isolation (for example `design/macos/design.md:27`,
`design/ios/design.md:18`). The product-wide dials above are aggregate across five shells
and are not a contradiction of those per-shell lines.

## 6. What this product is NOT

- Not a marketing landing page. The root route serves the OS shell itself:
  `app/[[...slug]]/page.tsx` renders `OsRoot`; the only other public pages are `app/login`
  and `app/install` (setup and platform instructions). There is no hero, pricing grid or
  feature-tour route. The product is a tool an operator uses on their own machine.
- No invented metrics or vanity counters. Operational numbers must come from the host
  (`lib/host/`), and the shell docs explicitly forbid fabricated readings: the iOS contract
  calls out that "the unavailable-weather state avoids fabricated readings"
  (`design/ios/design.md:18`).
- No testimonial, logo-wall or pricing-tier sections. There is no billing surface and no
  third-party social proof in the shell; the value is a terminal, a file manager, a monitor
  and a browser over one VPS.
- No gradient-as-brand. Backdrops are wallpapers (`globals.css:242-264`) and the Dashboard
  deliberately stays "a pure gradient" so a photo does not fight data widgets
  (`globals.css:246`); identity comes from chrome geometry, not from a color wash.
- No second design system per feature. Cross-shell behavior is shared and only presentation
  forks (`design/README.md`: "Feature code must not fork business logic by OS").
- No decorative accent spread. Accent marks selection, focus, primary action and status,
  per `windows/design.md` and the 5% Mica tint comment.

## 7. Known gaps

Honest list. None of these are fixed here; this file only records them.

1. **Glass count exceeds R-10.** `backdrop-blur` appears in 34 source files (`.tsx`, `.ts`,
   `.css`) of this repo, 40 occurrences; 37 files if markdown docs are counted too. R-10
   caps glassmorphism at 1 to 2 simultaneous elements per screen. A per-screen review is
   outstanding and not done. Most of these are transient or full-screen tiers (lock screen,
   control center, launcher, context menus), which is plausibly fine, but "plausibly" is
   not a review.
2. **Serif is unused.** Every preset declares `font-serif`, the loader fetches it, and no
   chrome or app surface consumes it. Either it becomes a real type role or the dead token
   should be dropped. Owner decision, recorded as `UNSET` in section 3.
3. **Preset elevation tokens are inert.** `shadow-*` values ship per preset in
   `registry-data.json` but `apply.ts` never injects them, so `--shadow-win` and
   `--shadow-pop` stay at their `globals.css` values under every preset. Current behavior
   is consistent (one elevation language), but the registry data is misleading.
4. **Palette count is picker-dependent.** The stock palette respects the 2 to 3 plus 1
   accent cap. All 36 registry entries ship a full palette (29 reachable from the picker),
   so restraint in any given screenshot depends on which preset is active, not on a gate.
5. **Dashboard lacks a fixed rhythm source.** Its own contract asks for 8px rhythm, but the
   spacing base in the registry is `0.25rem` for every preset and no dashboard-specific
   spacing token exists. Rhythm is convention in component classes, not a token.
6. **`--tracking-normal` is a single global.** Only `supabase` deviates (`0.025em`). The
   scale is a multiplier set, so tracking cannot be tuned per role (heading vs micro-label)
   without new tokens.

Enforced quality bar that is real and not aspirational: `scripts/check-contrast.mjs` fails
the build on any WCAG AA (4.5:1) regression across 4 pairs (`text`, `muted text`,
`primary button`, `destructive`) in all 36 presets x 2 modes plus `globals.css`, and it
runs in `scripts/gates.sh:59` and `package.json` `check`. Current run: 36 presets x 2 modes
scanned, 0 failures light, 0 failures dark.
