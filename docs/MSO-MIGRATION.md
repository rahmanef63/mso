# MSO migration plan — Svelte / Bun / Rust

Status: **open plan, not implemented.** Measurement-first. Nothing here is approved to
start until §3 gate is signed off with fresh numbers from the target host.

Baseline commit: `1c74603` (2026-10-27), app `0.2.23`.
Measurement host: ASUS laptop, WSL Ubuntu, node `26.7.0`, bun `1.4.2`, Next `16.4.2`.
Measured: 2026-10-28.

Live instances that must stay green during any phase: three of them — the local laptop
instance, a second host running the same build, and the VPS instance that is treated as
the source of truth. Their hostnames are deliberately not recorded here; see the
operator's private deployment notes.

---

## 0. Code inventory (static)

| Area | Files | LOC | Portability |
|---|---|---|---|
| `lib/` | 1,200 | 98,942 | 1,177 files (96,437 LOC) import neither `react` nor `next/*` → already framework-agnostic |
| `frontend/slices/` | 943 | 74,176 | React-coupled; 32 slices; `appshell` alone is 20,028 |
| `app/` (pages + routes) | 223 | 14,774 | 4 pages, 1 layout, 117 `route.ts` (6,305 LOC) |
| `components/ui/` | 23 | 1,558 | Radix wrappers — the only `@radix-ui/*` consumers |
| `scripts/` | 153 | 9,974 | already partly Bun |
| tests | 858 files | 5,583 assertions | vitest |

Next-specific surface actually used:

```
next/server      162 files (NextRequest 122, NextResponse 744)
next/headers       4
next/navigation    3
next/link          1
next/font/local    1
next/og            1
"use client"     481 files
"use server"       1 file
```

Radix usage is concentrated: 11 packages, 13 files. No monaco, no react-three.
Heavy optional engines: xterm + onnxruntime (`@imgly/background-removal`).

`node:` builtin usage across `lib/` + `app/` + `components/` (482 files):

```
node:path 356   node:fs 267   node:os 259   node:crypto 155
node:fs/promises 68   node:child_process 43   node:net 15
node:util 14   node:events 6   node:http 5   node:zlib 4   node:stream 4
```

React surface in `frontend/` + `app/` + `components/`: `useState` 239 files,
`useEffect` 147, `useMemo`/`useCallback` 106, `createContext` 16, `forwardRef`/`React.*` 113.

Slice sizes and appshell coupling (risk ordering input):

| Slice | LOC | files importing `@/features/appshell` |
|---|---|---|
| `appshell` | 20,028 | — (it is the shell) |
| `os-settings` | 8,915 | 0 (`"use client"` in 76/78 files) |
| `image-editor` | 6,966 | 0 |
| `reel-editor` | 6,539 | 3/62 |
| `assistant` | 5,430 | 0 |
| `managed-apps` | 3,080 | 0 |
| `files-manager` | 2,809 | 0 |
| `icon-picker` | 2,766 | 1/32 |
| `app-store` | 2,196 | 4 |
| `code-editor` | 1,782 | 0 |
| `workflows` | 1,734 | 0 |
| `os-terminal` | 1,482 | 4/15 |
| `auth` | 1,406 | 2/19 |
| `media-viewer` | 1,363 | 1 |
| `os-shell` | 955 | 5 |
| `organization` | 889 | 2 |
| `system-monitor` | 759 | 4/14 |
| `image-picker` | 683 | 1/13 |
| `memory-graph` | 536 | 3/9 |
| `camoufox-browser` | 470 | 1/7 |
| `channels` | 462 | 3/7 |
| `agent-group` | 450 | 3/7 |
| `agent-vault` | 409 | 4/11 |
| `media-studio` | 332 | 3/5 |
| `create-app` | 312 | 2/5 |
| `integrations` | 299 | 1/6 |
| `shell-settings` | 285 | 0/7 (fully decoupled) |
| `extensions` | 278 | 1/11 |
| `docs` | 220 | 3/4 |
| `infrastructure` | 130 | 1/2 |
| `n8n` | 128 | 2/4 |
| `quicklinks` | 83 | 2/3 |

Cross-slice import counts (barrel discipline): `appshell` 23, `os-settings` 6,
`os-shell` 5, `app-store` 4, `agent-group` 4, `extensions` 3, `channels` 3,
`organization` 2, `auth` 2, `assistant` 2, `os-terminal` 1, `media-viewer` 1.
Every slice except `infrastructure` already has an `index.ts` barrel — the strangler
boundary is already written down.

Architecture ratchets currently enforced (`architecture.boundaries.json`):
`structuralCycles 0`, `crossDomainCycles 0`, `crossProtocolCycles 0`,
`serverFrontendImports 0`, `filesOver500 0`, `filesOver220 43`, `cliEntrypointLines 220`,
`installerCoreLines 450`. Any migration must keep these at equal-or-lower values.

---

## 1. Measurements (2026-10-28, commit `1c74603`)

### 1.1 Build

`mso build` runs three stages: isolated Next build → Playwright runtime → mandatory
release E2E. Timed end to end with `/usr/bin/time -v`.

| Metric | Value |
|---|---|
| **`mso build` total** | **322 s (5:22)**, peak RSS 2.31 GB |
| ├ Next compile (Turbopack) | 8.6 s |
| ├ `tsc --noEmit` | 16.2 s, 1.19 GB RSS |
| └ E2E + bundle-budget verify | ~296 s (**92 %** of build) |
| `tsc --noEmit` alone | 8.4 s wall, 1.19 GB RSS |
| SvelteKit minimal baseline (`vite build`, same box) | **1.85 s**, 658 MB RSS |
| SvelteKit minimal `bun install` (56 pkgs) | 1.88 s |

Bundle budget gate output inside the build:

```
bundle initial: 882.0 KiB raw / 281.0 KiB gzip (18 files)
bundle entry:   448.3 KiB raw / 151.5 KiB gzip (13 files)
bundle css:     184.1 KiB raw /  30.0 KiB gzip  (2 files)
bundle fonts:    68.0 KiB raw /  68.1 KiB gzip  (1 file)
```

`scripts/bundle-budget.json` currently allows `initial 307200 gzip`, `entry 163840`,
`css 30720`, fonts `81920`. Actual initial is 281 KB against a 300 KB ceiling.

**Conclusion: compilation is 2.7 % of build time. A Svelte rewrite cannot fix build
time. The 5-minute build is the Playwright release gate.**

### 1.2 Test

| Runner | Result |
|---|---|
| `vitest run` (full) | 41.4 s wall, 5,583 pass / 0 fail, 858 workers, 567 MB RSS |
| `vitest run lib/mcp` | 6.14 s wall, 20 files |
| `bun test lib/mcp` | 5.99 s wall, **243 pass / 98 fail / 23 errors** |

Vitest itself reports: 858 workers spawned at ~122 ms each, and estimates that
`isolate:false` "would save ~6.84 s (16 %)". **That estimate is wrong for this suite and is
retracted here.** Measured 2026-10-29: full suite `isolate:true` is 42.6 s green; with
`isolate:false` + `pool:"threads"` it is 65.9 s (**54.5 % slower**) and 52 files / 161 tests
fail. Excluding the breakers exposed new cascade failures on every re-run (52 → 24 → 12 → 11,
ending in 45 s timer timeouts), and even after excluding ~110 files the run still failed
non-deterministically on cross-thread mock leakage. The suite shares process singletons —
`process.env`, `window`, `localStorage`, `globalThis.fetch`, the approved-device registry,
A2A token store, standby worker state, fetch interceptors, systemctl mocks — so a module
registry shared across files is not a safe default here. Per-file isolation stays.

Bun's runner is ~1.1 s faster on the same 85-file subset and does not run the suite as
written. Observed blockers: `vi.mock("server-only", …)`, jsdom environment, `localStorage`
flag assumptions. Not a drop-in.

`bun install` of this repo's own `package.json` **fails** outside the existing tree:

```
> Rebuilding because directory node_modules/node-pty/prebuilds/linux-x64 does not exist
/usr/bin/bash: node-gyp: command not found
error: install script from "node-pty" exited with 127
```

Install portability is currently npm/node-gyp-shaped. This blocks Bun as a stack choice.

### 1.3 Client bundle

Route `/[[...slug]]` is the entire shell, so its first-load set is the product's
first-load set.

| Metric | Value |
|---|---|
| First-load JS | 897 KB raw, 20 chunks |
| Initial (eager shell budget) | 882 KB raw / **281 KB gzip** |
| Entry chunk | 448 KB raw / 151.5 KB gzip |
| CSS | 184 KB raw / 30 KB gzip |
| Fonts | 68 KB |
| All chunks shipped | 5.51 MB raw / **1.59 MB gzip** |
| `react-dom` first-load chunk | **230 KB** |
| Deferred (not first-load) | onnxruntime-web 2 × 380 KB, xterm 322 KB |

Per-chunk first-load breakdown (largest first):

```
230 KB  react-dom        2uq1r5nfrxpmw.js
155 KB  app code         17m6xheheb8d-.js
 71 KB  app code         15vf0xb5yvhvg.js
 62 KB  app code         0juouw7m1iugm.js
 61 KB  app code         239mdbdf4esdv.js
 41 KB  app code         2n5sb_sdwp_j_.js
 35 KB  app code         0w53v9augwoup.js
 32 KB  radix            2yrl7mnjm--25.js
 30 KB  app code (×2)
 27 KB  25 KB  23 KB  14 KB  11 KB  8 KB  5 KB  5 KB  1 KB
TOTAL 897 KB / 20 chunks
```

Route-level stats (`route-bundle-stats.json`, only 5 routes exist):

| Route | First-load JS |
|---|---|
| `/[[...slug]]` | 897 KB |
| `/login` | 810 KB |
| `/oauth/authorize` | 497 KB |
| `/install` | 476 KB |
| `/_not-found` | 453 KB |

`node_modules` is 1.2 GB (373 packages), of which `next` alone is 210 MB.

### 1.4 Server runtime (live instance, `127.0.0.1:4005`)

| Metric | Value |
|---|---|
| HTML TTFB (root) | 10–14 ms |
| API TTFB (`/api/status`) | 4–8 ms |
| API TTFB (`/api/v1/apps`, 401 path) | 5–7 ms |
| Server RSS total | 284 MB (`next-server` 110 MB + `scripts/server.mjs` wrapper 174 MB) |
| Boot network requests | 129 total, **2 API calls** (`/api/auth/me`, `/api/prefs`) |
| Root HTML size | 20,765 B (desktop), 7,115 B (deep link) |
| DOM nodes after hydration | 870 desktop / 1,165 mobile |

Server RSS budget enforced in E2E is only "streaming growth < 128 MiB", not absolute.

### 1.5 Perceived performance (Playwright, Slow 4G emulation + 4× CPU throttle)

Measured with `PerformanceObserver` (`longtask`, `largest-contentful-paint`,
`layout-shift`) injected via `addInitScript`, network shaped by CDP to
150 ms RTT / 1.6 Mbps down / 750 kbps up (Lighthouse "Slow 4G"), CPU throttled 4×.
Reproducible with `bun run perf:probe`.

Two earlier numbers in this document were wrong and are corrected here:

- The first pass used 200 kbps down (Slow **3G**). The 900 KB shell then needs ~37 s to
  arrive, which measures the network, not the shell. Re-measured at Slow 4G.
- The first pass reported TBT as the **raw sum of long-task durations**. TBT by
  definition is the sum of `max(0, duration − 50 ms)` per long task. The corrected
  number is roughly a third of the old one.

A third assertion in this document was wrong and is retracted here:

- The document asserted that LCP is set by first paint (CSS + wallpaper) and therefore
  framework-neutral. That was disproved by measurement on 2026-10-29
  (`bun run perf:hydration`). LCP is hydration-bound.

| Metric | Desktop 1440×900 | Mobile 390×844 |
|---|---|---|
| FCP | 1,180 ms | 1,166 ms |
| **LCP** | **3,222 ms** | **3,054 ms** |
| **TBT** | **164 ms** | **132 ms** |
| Long tasks | 4 | 4 |
| Max single long task | 126 ms | 126 ms |
| CLS | 0.001 | 0 |
| DOM nodes after hydration | 870 | 1,165 |

Values are the median of 3 runs against the synthetic `releaseFixture` (the path CI
takes), with the first run of a session discarded as warm-up: a cold disk cache inflated
TBT to 418 ms against 164 ms warm, a 2.5× error that would have failed the gate on every
fresh runner. Observed spread across stable runs: desktop TBT 150–184 ms, mobile
69–148 ms, LCP 2.98–3.22 s. Host load moves these by ±25 %, which is why the gate
enforces a 2× blowup rather than an absolute cap.

Hydration mark chain (`bun run perf:hydration`, desktop 1440×900, Slow 4G + 4× CPU).
Two representative runs, plus the spread across all runs on this host:

```
                          run A    run B    observed range (11 runs)
  FCP                     1208 ms  1180 ms  1160-1440 ms
  last JS arrival         3078 ms  2921 ms  2850-3320 ms
  shell mounted           2792 ms  2654 ms  2570-3040 ms   (#main-content gains data-shell)
  icons painted           3839 ms  3790 ms  3200-4120 ms
  LCP                     3932 ms  3884 ms  3170-4220 ms   (element: SPAN menu-bar label)
```

Mobile measures the same shape with an `IMG` (app-icon artwork) as the LCP element:
LCP 3400-3808 ms, mounted 2713-2923 ms, last JS 2905-3095 ms.

Median desktop LCP across those 11 runs is ~3.8 s. Quote the range, not a point value:
a 1 s spread on the same commit is host load, not a regression.

The spread is run-to-run variance, not instrumentation overhead: the same load measured
with no observers at all produced 3724 / 3768 ms, with a per-frame `requestAnimationFrame`
poller 3676 / 3208 ms, and with a 100 ms interval poller 3172 / 3248 ms. The §1.5 table
above reports the median of a separate 3-run batch (3,222 ms desktop), which sits inside
that same range — the numbers are the same measurement seen at different times, not a
contradiction, and treating any single figure as exact would be wrong.

What is stable across every run is the *shape*: LCP lands ~2.0-2.8 s after FCP and
~0.4-1.0 s after the last JS byte arrives, and mount itself lands ~1.5-1.6 s after FCP.
Controls that isolate the levers:

```
throttle            LCP
Slow4G + 4x CPU     3884-4004 ms
Slow4G + 1x CPU     3108 ms          (-644 ms: CPU is a real lever)
no limit + 4x CPU   2236 ms          (-1516 ms: network is the bigger lever)
```

Network is the bigger lever; CPU is real but smaller.

Cause: from `frontend/slices/appshell/components/desktop.tsx` (~line 84), the shell
renders **only after mount** by deliberate design — the surface depends on
`window.innerWidth`, `localStorage sv:shell`, and the wallpaper pref, so SSR guesses
macOS and a phone hydrates iOS. SSR therefore paints a skeleton (`#main-content` with no
`data-shell`, 82 DOM nodes) and the real shell arrives after ~942 KB of first-load JS is
downloaded and executed.

LCP is therefore **hydration-bound**, i.e. gated by ~942 KB of first-load JS.

Same page, unthrottled local, cold cache:

```
desktop  DCL 52 ms   load 124 ms   FCP 64 ms   20 JS files  285 KB JS  384 KB transfer
mobile   DCL 49 ms   load  97 ms   FCP 56 ms   same
```

Warm cache (second visit):

```
TTFB 11 ms   DCL 64 ms   load 236 ms   75/77 resources from cache
```

Deep link `/files` cold: 1,816 ms wall, 7,115 B HTML — server renders per-route title +
session, then the client shell takes over.

Opening an app window inside the running shell at 4× CPU (`bun run perf:apps`, one cold
context per app so the cost is attributable):

```
Image Editor    window visible ~550-600 ms   +8 chunks   ~600 ms long task
Video Editor    ~450-470 ms                 +4           ~300 ms
System Monitor  ~230 ms                     +2            ~75 ms
Terminal        ~190 ms                     +3            ~60 ms
```

Image Editor and Video Editor each pull editor chunks and pay 300–600 ms of main-thread
time — those two are the per-slice measurement that matters, and they are also the two
places where a framework swap would show up first.

**Conclusion: server and in-shell navigation are already good. TBT is 164 ms desktop /
132 ms mobile, i.e. already at or near the 150 ms post-migration target before any
migration. But the earlier conclusion that LCP is paint-bound was wrong: LCP is 3.2-4.2 s
on throttled desktop and is hydration-bound, gated by ~942 KB of first-load JS. The
primary lever is network (−1,516 ms unthrottled), with CPU as a secondary lever (−644 ms
at 1× CPU). A framework swap that cuts first-load JS directly attacks the LCP critical
path.**


---

## 2. What each piece of the proposed stack can and cannot deliver

### 2.1 Svelte / SvelteKit

#### Measured framework floor (2026-10-29)

The hybrid-island numbers in §4 are not the migration's numbers: an island adds a runtime next
to React, a swap replaces it. The floor was therefore measured directly, from a minimal
SvelteKit build in `/tmp` (no dependency added to this repo), per-file gzip summed the way a
browser actually downloads it, then confirmed in a browser at Slow 4G + 4x CPU:

| Part | SvelteKit | Next + React |
|---|---|---|
| UI runtime | Svelte 5 runes/DOM, 14.94 KB gzip | `react-dom` 73.6 KB |
| Router + client engine | 14.81 KB gzip | Next client 44.2 + `next/navigation` 8.2 = 52.4 KB |
| Root/preload/registry/entry | 3.32 KB gzip | turbopack 4.4 + next-isr 2.3 = 6.7 KB |
| **Framework floor** | **33.07 KB gzip** | **132.70 KB gzip** |

The whole client bundle of the minimal app is 36.90 KB gzip; a realistic page with a nested
layout, a 50-row fetch-driven list, filtering and a re-fetch button added **4.43 KB gzip**, and
the browser measured 35.16 KB first-load JS for the minimal page and 36.57 KB for that page,
i.e. the per-file arithmetic was honest to within 1.7 KB.

**Arithmetic that matters.** Framework floor falls 132.70 → 33.07 KB gzip, a **99.63 KB (75 %)
reduction in framework tax**. Holding app code at today's 145.5 KB gzip, MSO's first-load would
land at **178.6 KB gzip instead of 278.2 KB**, a 35.8 % cut before any template-savings.

That last figure is the honest bound, not a forecast: Svelte's app code is new code, not the
same 145.5 KB. Svelte should shrink it (no `createElement` calls, runes compile inline instead
of hook closures, `bind:` instead of handler boilerplate) but it could grow if the shell ends up
as many tiny presentational leaves, each compiling to imperative DOM instructions. A defensible
planning range is app code 115–130 KB gzip, so total **148–163 KB gzip**, roughly −40 to −46 %.

Delivers:
- ~180–230 KB gzip less first-load JS (`react-dom` 230 KB raw + Next router runtime).
  Realistic post-migration initial: 281 KB gzip → **~90–110 KB gzip**.
- Direct LCP cut: LCP 3.2-4.2 s is gated by 942 KB first-load JS; removing ~230 KB of
  `react-dom` plus the Next router is a direct cut into the LCP critical path, so a
  3.2–4.2 s → ~2.5–2.9 s is the realistic expectation, and it is now the primary
  argument for the migration rather than a bundle-aesthetics one.
- Less main-thread work at startup. Measured attribution (`bun run perf:tasks`) puts
  ~280 ms of ~355 ms total long-task self time on the `react-dom` chunk — so removing
  it removes real work, but TBT is already 164 ms, which means most of that 280 ms
  overlaps idle time rather than blocking interaction. Expect TBT to move from 164 ms
  toward ~60–90 ms, not from 443 ms.
- `next/server` 162 imports and 117 route handlers collapse to `+server.ts` functions.
- One mental model (no RSC/hydration split). Faster `svelte-check` than full-repo `tsc`
  (8.4 s today for 202 k LOC).
- Smaller `node_modules`: `next` alone is 210 MB of the 1.2 GB.

Does not deliver:
- Build time (§1.1: compile is 2.7 % of the build).
- Server RSS: SvelteKit SSR is still Node/Bun. It does not shrink the 110 MB process.
- Anything for `lib/`: 96 % of it is already portable, so rewriting it is pure cost.

Costs:
- 74,176 LOC of React components + 14,774 LOC of app layer re-expressed.
- 11 Radix packages across 13 files → bits-ui / melt-ui. `@imgly/background-removal`
  has no Svelte-native equivalent (keep it as a framework-agnostic island).
  Phosphor has a Svelte build; Radix does not.
- 858 test files: most touch React/Next APIs. Re-write, not port.
- Three live instances must stay green. The real cost is maintaining two stacks during
  the transition, not the coding.
- `frontend/slices/appshell` (20,028 LOC, config-driven registry with `ReactNode` and
  `ComponentType` in its public types) is the single hardest piece and cannot be a
  "small first step".

### 2.2 Bun (runtime)

Delivers:
- Faster install, `bun test` (marginal here: ~1.1 s on the measured subset).
- Single-binary distribution eventually.
- One less toolchain in scripts (roughly half of `scripts/*` already runs under Bun).

Does not deliver today:
- Next.js under Bun is not first-class. Bun only becomes relevant **after** Next is gone.
- 482 files use `node:` builtins. `node:child_process` appears 43 times; process/pty
  semantics is exactly where Bun diverges and exactly where `lib/orchestration` lives —
  the most dangerous place to discover a difference.
- `bun install` currently fails on `node-pty` postinstall (§1.2).

### 2.3 Rust

Justified only for: `proxy.ts` (354 LOC) plus its 3 test files — host→managed-app
rewrite, CSRF depth-2, per-request CSP nonce, websocket upgrade detection.
Also plausible: filesystem scanning, hashing in `lib/security`.

Not justified as: a rewrite of 202 k LOC TS with 33 runtime dependencies (anthropic sdk,
mcp, nakama parity, xterm, onnxruntime) across three live deployments. That is not a
migration, it is a new product.

If server RSS matters: `next-server` 110 MB → a Rust HTTP core could plausibly land near
15–25 MB. That is a **hosting cost** win, not a **user speed** win. Do not sell it as UX.

Never port `lib/orchestration` to Rust; `child_process`/pty semantics are the product's
entire failure surface.

---

## 3. Decision gate — do this before any rewrite

**The gate now reopens on measured grounds.** The earlier claim that LCP was set by
first paint (CSS + wallpaper artwork) and therefore framework-neutral is disproved.
With LCP at 3.2-4.2 s across runs (landing 2.0-3.0 s after FCP and 0.4-1.1 s after the last
JS byte arrives), LCP is hydration-bound to the ~942 KB first-load JS bundle.

LCP cannot be painted away. Therefore, "fix LCP cheaply first" becomes an ordered list
of the measured options, cheapest first:

1. **Shrink the eager graph and lock the measured baseline (250/256 KiB is post-migration).**
   The earlier assumption that lowering `scripts/bundle-budget.json` to 250/256 KiB gzip
   is a quick in-tree first move is disproved by the measured framework floor. Next.js
   and React runtime chunks alone account for **132.7 KiB gzip** of the first-load
   bundle (react-dom 73.6, Next client 44.2, next/navigation 8.2, turbopack 4.4,
   next-isr 2.3 = 53 % of a 250 KiB target). App code is currently 148.3 KiB gzip
   (281.0 KiB initial − 132.7 KiB floor). Reaching a 250 KiB ceiling would require app
   code ≤ 117.3 KiB — a **21 % cut** ((148.3 − 117.3) / 148.3 = 20.9 %) that cannot be
   achieved by routine app trimming while retaining the React shell and its eager
   dependencies. The 250/256 KiB target is therefore an advisory post-migration goal,
   not an in-tree quick fix.
   In-tree, the ceiling in `scripts/bundle-budget.json` is tightened arithmetically from
   measured parts rather than left at an inert 300 KiB round number: 132,670 B framework
   floor plus 155,048 B app entry with 2.0 % headroom (3,101 B) sets the entry ceiling to
   158,149 B and initial ceiling to 290,819 B gzip.
   Two eager-graph leaks were then closed and measured with an out-of-tree build:
   `use-installed-apps.ts` no longer imports `RuntimeApp` statically, and the `assistant`
   barrel no longer re-exports `installAlfaSources` (which pulled `HOST_TOOLS`). Result:
   initial **281.0 → 278.2 KiB gzip** (−2.8), entry 151.4 → 148.6 (−2.8), app code
   148.3 → 145.5 KiB.
   That is worth stating plainly because it corrects an estimate: the two leaks were
   projected at 15–20 KiB and 8–12 KiB, and the measured total is **2.8 KiB**. Both fixes
   are still correct — they remove work every visitor paid for — but neither moves the
   21 % figure, and neither is an LCP win: 2.8 KiB is ~1.4 % of a 200 KB critical path.

   The same measurement that makes 250 KiB hard in-tree makes it trivial after a swap:
   the SvelteKit floor measured in §2.1 is 33.07 KiB gzip, so a swapped shell would need
   app code ≤ 217 KiB to stay under 250, more headroom than today's 145.5 KiB uses. The
   250/256 KiB target is therefore not a stretch goal at all once React and Next are gone;
   it is in-tree that it is out of reach, because 132.7 KiB of the budget is framework.
   *Measurement support:* Supported directly by the network throttle control
   (−1,516 ms when unthrottled). The last JS byte arrival (2.9-3.1 s) gates mount and
   LCP; every kilobyte cut from the eager download shortens the critical path.
2. **Keep the wallpaper art off the LCP critical path.** Ensure wallpaper fetch does
   not contend with first-load JS or trigger late layout shifts on mobile
   (`IMG.shell-artwork` was measured as LCP on mobile), using a CSS placeholder/gradient.
   *Measurement support:* Speculative for desktop (where the measured LCP element is a
   `SPAN` menu-bar label painted after JS hydration, not the image), but
   prevents bandwidth contention on constrained mobile connections.
3. **Cut shell mount cost.** Profile and reduce component initialization inside
   `frontend/slices/appshell/components/desktop.tsx` and the eager slice registry during
   `#main-content` hydration (mount ~2.6-3.0 s → LCP ~3.2-4.2 s).
   *Measurement support:* Measured 2026-10-29 (`bun run perf:tasks` + CDP trace analysis,
   Slow 4G + 4× CPU). Between FCP and LCP there is ~800–950 ms of main-thread execution
   split across two phases. Pre-mount (FCP → mount ~2.6 s): ~220 ms React 19 runtime
   bootstrap (`2uq1r5nfrxpmw.js`), ~195 ms eager slice registry and manifests evaluation
   (`3vzf2l_pzsqlz.js`: Alfa tools, quicklinks, appearance presets, 29 app descriptors),
   and ~100–140 ms initial skeleton hydration. Mount → LCP (~2.6 → 3.3–4.0 s): the lazy
   `macos-shell` chunk (45 KB raw / ~14 KB gzip, `1mmmz82o-7zp9.js`) is fetched and
   evaluated, then a 260 ms long task renders `DesktopChrome` (~145 ms React component
   tree, 74 ms UpdateLayoutTree, 40 ms Layout), finishing with ~25–40 ms Paint to the
   menu-bar `SPAN` LCP element. Suspects rejected by measurement: `Wallpaper` execution is
   <2 ms (CSS backdrop loads asynchronously, off the main thread); icon artwork decode is
   0 ms (async WebP decodes; desktop LCP is text).
   The shell-chunk fetch is *already* concurrent with mount, not serial after it: measured
   request start 2573 ms against mount 2591 ms, response end 2869 ms. Prefetching it from
   inside the app therefore buys nothing — verified, not assumed. Buying anything back
   would require starting the fetch before hydration, which in turn requires knowing the
   surface at SSR time, which is exactly the thing that causes the macOS/iOS hydration
   mismatch. That circularity, not the byte count, is why this lever is structural. It
   could be broken by preloading both shell chunks from the server (≈+14 KB gzip for
   everyone to save ~0.3 s for two thirds of visitors), which trades against §3 item 1 and
   should be decided as a product call, not folded in as an optimization.
4. **Migrate a slice (Phase 3).** If in-tree budget and mount optimizations leave LCP
   > 2.5 s, a framework migration is the only remaining lever that removes ~230 KB of
   `react-dom` runtime and Next router overhead from the first-load critical path.
   *Measurement support:* Supported by both network and CPU controls. Phase 3 is now
   the honest test of a real win (LCP 3.2–4.2 → ~2.5–2.9 s) instead of a
   bundle-aesthetics exercise.

(`isolate:false` was considered as an independent dev-loop win and rejected: measured 54.5 %
slower with 161 failing tests; see §1.2.)

Gate criteria to proceed past §3 — all three required:

- LCP on Slow 4G + 4× CPU is still > 2.5 s after (1), (2), and (3), **and**
- a named slice proves Svelte parity in a real browser at equal-or-better LCP (targeting
  the ~2.5–2.9 s window), **and**
- build time is addressed separately (it is an E2E problem, not a framework problem).

Note what is *not* in that list: TBT. Gating on it would be gating on a number the
current build already meets.

---

## 4. Phased migration (only if §3 gate passes)

Rule for every phase: **no user-visible UX change, no second login, no second cookie
domain, no dropped deep link.** Rollback at every step is a config flip, not a revert.
Every phase keeps the architecture ratchets in §0 at equal-or-lower values.

### Phase 0 — Instrumentation (DONE, 2026-10-28)

Shipped:

| Command | Purpose | Gate |
|---|---|---|
| `bun run perf:probe` | Cold load, Slow 4G + 4× CPU, → `perf-report.json` | no |
| `bun run perf:check` | Enforces `scripts/perf-budget.json` | **yes** |
| `bun run perf:tasks` | CDP trace → long task → owning script | no |
| `bun run perf:apps` | Per-app open latency, chunks, long tasks | no |

Files: `scripts/perf-probe.mjs`, `scripts/check-perf.mjs`, `scripts/perf-longtasks.mjs`,
`scripts/perf-app-open.mjs`, `scripts/lib/perf-report.mjs` (+ vitest),
`scripts/perf-budget.json`, `scripts/perf-baseline.json`.

Gate policy: bytes are already gated deterministically by `check-bundle.mjs` from build
output, so the perf gate does **not** re-gate browser-measured bytes (they count deferred
chunks and are noisy). It gates the 2× TBT blowup against the committed baseline, and
fails on a *missing* TBT rather than passing it — a null measurement is an instrumentation
failure, not a fast page.

Phase 0 findings that changed the plan: §1.5 corrections (Slow 4G, not 200 kbps; TBT
definition), and the resulting conclusion in §3 that TBT is already at target and LCP is
the real number.

Exit criteria met: numbers in §1.4/§1.5 reproducible with one command on any host, median
of 3 runs committed as baseline.


### Phase 1 — Bun for tooling only (2–4 days, zero product change)

- Keep Next on Node. Keep vitest.
- Move remaining `scripts/*.mjs` that are still npm/node-shaped to Bun where tests
  already pass under Bun.
- Fix the install portability blocker: `node-pty` prebuild or a Bun-compatible
  postinstall. Until that is fixed, Bun is a dev convenience, not a stack choice.
- Not on the table: `isolate:false` for vitest. Measured 54.5 % slower with 161 failing
  tests (§1.2); per-file isolation stays.

Exit criteria: `bun install` succeeds from a clean clone; all `scripts/*` green under
Bun; `next` still on Node; build time unchanged or better.

### Phase 2 — Framework-agnostic core (2–3 weeks, zero product change)

The largest durable win and the cheapest real work, because 96 % of `lib/` needs nothing.

- Formalize the boundary: `lib/` exports plain request/response types; nothing in `lib/`
  may import `next/*`. **Done 2026-10-29** for the static-import half: the seven files that
  imported `next/server` or `next/headers` now use the web-standard `Request`/`Response`,
  and `grep -rn 'from "next/' lib` (non-test) is 0. `NextResponse.cookies.set` became an
  explicit `Set-Cookie` header in three files, with the same attributes and the same
  `base64url` payloads, so no encoding change.

  **Done 2026-10-29 for the dynamic half too.** The one remaining exception was
  `lib/auth/require-session.ts` reaching Next through a *dynamic* `import("next/headers")`
  inside the default `nextSessionCookieReader`, because `cookies()` is request-scoped
  framework plumbing. That reader now moved to the framework entry: `instrumentation.ts`
  imports `next/headers` once at boot and calls `registerSessionCookieReader(...)`, while
  `lib/auth` holds only a registered callback and a `defaultCookieReader()` that THROWS a
  named error when nothing registered. Nothing is threaded through the 54 call sites, the
  seam stays a default parameter, and a SvelteKit adapter can register its own reader the
  same way. The failure mode is deliberate: an unregistered reader fails closed and loud,
  never silently unauthenticated. The exit criterion is now a plain `next/*` grep in `lib/`,
  which covers both static imports and `import(...)`.
- Convert the 117 `route.ts` handlers into thin adapters: one shared
  `NextRequest → { request, ctx }` shim, all logic in `lib/`. Handlers become 3–5 lines.
  (`NextResponse` 744 usages, `NextRequest` 122 — the shim is the whole job.)
- Extract session/auth/CSP into a typed `HttpContext` module so the same code can serve
  SvelteKit `+server.ts` later without edits.
- Keep `proxy.ts` as-is; it is ported in Phase 6, not here.

Exit criteria: no static `next/*` import in `lib/` (met); every route handler ≤ 15 LOC;
ratchets unchanged; full suite green.

Value even if the migration dies here: the backend becomes portable and testable without
a framework. Worth doing on its own.

### Phase 3 — One low-risk slice as a Svelte island (3–4 weeks)

Phase 3 is the single proof-of-mechanism island, not a full migration phase. Its sole
purpose is to verify that a compiled Svelte component mounts inside the running React
shell without regressing shell TBT, bundle budget, or the 132.7 KB framework runtime
floor.

Pick from the decoupled leaf slices in §0: `quicklinks` (83 LOC) is too small to prove
anything; `n8n` (128 LOC, 2/4 appshell imports, prefetch: "never", separate embed
surface) is the primary target, with `infrastructure` (130 LOC, 1/2) as second.

Method (strangler, no shell rewrite):
- Build the Svelte component as a static island bundle (Vite lib mode), mount it inside
  the existing React shell at exactly one route/window.
- The React shell keeps ownership of window chrome, auth, cookies, deep links.
- Ship behind the existing URL. No new origin, no new host header.
- Gate on Phase 0 metrics: the island must not regress shell TBT or first-load bytes.
- Rollback: remove one mount point.

Exit criteria: the slice live for real users for 2 weeks, zero rollback, metrics equal or
better.

**If one island is not clearly better after 2 weeks, stop the migration here** and keep
the Phase 2 portable core. That is a good outcome, not a failure.

#### Spike result (2026-10-29): a hybrid island is the wrong shape

Before spending the 3-4 weeks above, the mechanism was measured in a throwaway `/tmp` build
(no dependency was added to this repo). Standalone ESM bundle, fully self-contained runtime,
gzip:

| Build | Svelte 5.57 | Svelte 4.2 | In-tree React equivalent |
|---|---|---|---|
| hello world | 15.75 KiB | 2.06 KiB | — |
| n8n-shaped component (list + button + fetch state) | 18.21 KiB | 3.80 KiB | **1.64 KiB** (`.next` chunk `0w0yqd71b0eao.js`) |

The React figure is small only because React is already resident — the shell paid for it once.
A Svelte island pays for its runtime *again*, next to React, and that is the whole problem:

- Svelte 5's runtime is **15.75 KiB gzip** of baseline before any component code. On Slow 4G
  that is ~85 ms of extra transfer, plus 20-35 ms of parse and signal-graph init at 4× CPU,
  before the island's first paint. Against a 1.64 KiB React chunk, a Svelte 5 island is a
  regression on every axis that Phase 3 was supposed to improve.
- Svelte 4 is small enough (2.06 KiB) that an island is not absurd, but porting to a
  previous major version to make a spike look good is not a plan.
- Mounting without restructuring the host means React hydrates `WindowContent`, commits the
  container, runs an effect, and only then instantiates Svelte — a double-mount penalty, plus
  every shell interaction (`openWindow`, session role, theme) crossing a framework boundary.

**Conclusion: do not build hybrid islands.** The honest integration point is
`AppDescriptor.load` in a slice's `index.ts`, and it should be used once — during the Phase 5
shell swap — not before. Islands were the plan's cheap early test; measurement says the test
would cost a second runtime to prove a point the framework floor already proves. Phase 3 is
therefore reclassified: its budget moves into Phase 5, and the gate to proceed is LCP as
described in §3, not an island.

### Phase 4 — Slice by slice (ongoing, ~1 slice / 2–3 weeks)

The earlier LOC-based ordering heuristic ("smallest slices first", with `os-settings` as the
test) is replaced with an empirical cost-density rule.

#### Ordering rule and constraints

1. **Framework runtime floor constraint:** The Next/React client runtime imposes an immovable
   floor of **132.7 KB gzip** (react-dom 73.6 KB, Next client 44.2 KB, next/navigation 8.2 KB,
   turbopack 4.4 KB, next-isr 2.3 KB). In a hybrid React shell, this floor remains in memory
   regardless of how many slices are ported. Therefore, a slice migration's byte win is bounded
   strictly by what that slice adds, and its user-visible win is bounded by the main-thread
   execution time it removes during window open or interaction.
2. **The rule:** **Highest main-thread execution cost per LOC** (`ms long task / kLOC` at 4× CPU
   throttle), tie-broken by **lowest `@/features/appshell` coupling** (fewer imports). Slices with
   measured performance data (§1.5) take priority over unmeasured estimates.
3. **Appshell exclusion:** `appshell` is 20,028 LOC, defines the window host and slot registry,
   and cannot be migrated slice-by-slice. It is reserved exclusively for the Phase 5 shell swap.

#### Measured vs. unmeasured data

Nine slices carry numbers from `bun run perf:apps` at 4x CPU: `image-editor` (1161 ms long
task), `system-monitor` (455), `workflows` (369), `reel-editor` (362), `code-editor` (302),
`organization` (264), `docs` (239), `memory-graph` (169), `os-terminal` (142). The figure for
each is the maximum of two runs, because the same slice varied by 2-4x between consecutive runs
on this host.

The remaining slices have **no number and no estimate**. They are unmeasured, and this document
does not guess: an invented ordering is worse than an unfinished one, because it reads as
evidence. Profile a slice with `bun run perf:apps --apps="<dock label>"` before its branch starts.

#### The two honest first slices

1. **First slice: `system-monitor` (759 LOC, 4/14 appshell imports).**
   - *Metric:* 455 ms measured long task (max of 2 runs) / 0.759 kLOC.
   - *Justification:* It has the highest execution cost per line of code. Unlike static forms, it
     runs a continuous reactive loop (polling system metrics, driving SVG charts, updating DOM).
     At 759 LOC, the blast radius is tightly constrained. It proves that Svelte's reactive bindings
     and compile-time reactivity eliminate React re-render churn in a live window, providing quick,
     low-risk validation of real runtime benefits.
2. **Second slice: `image-editor` (6,966 LOC, 0 appshell imports).**
   - *Metric:* 1161 ms measured long task (max of 2 runs) / 6.966 kLOC = **166.7 ms/kLOC**.
   - *Justification:* Zero coupling to `@/features/appshell` (completely decoupled strangler seam).
     It carries the single worst measured main-thread cost in the product: 1161 ms of long task
     and 790 ms to window-visible across the same session, with 8 chunks pulled on open (§1.5
     measured 550-600 ms and ~600 ms before the harness was re-run; both are inside the same
     order of magnitude). Porting it attacks the largest user-visible delay immediately after
     `system-monitor` proves the island architecture.

#### Proving ground verdict: `os-settings` is OVERTURNED

The previous claim that `os-settings` (8,915 LOC, 0 appshell imports) is "the real test" is
**overturned by measurement**:
- `os-settings` is a collection of static form controls, preference toggles and Radix wrappers.
  It is **unmeasured** — it has no dock icon, so `perf:apps` cannot open it by label and no
  number exists. The earlier "<25 ms" figure was an estimate and has been withdrawn.
- Because the 132.7 KB gzip framework floor remains loaded during Phase 4, migrating 8,915 LOC
  of form inputs yields virtually zero measurable user-speed improvement. Spending months porting
  nearly 9,000 lines of low-cost form code before touching performance bottlenecks is high risk
  with zero user-visible payoff.
- **What replaced it:** **`image-editor` (6,966 LOC, 0 appshell imports)** is the true proving
  ground. Like `os-settings`, it has zero appshell coupling. Unlike `os-settings`, it carries a
  measured 1161 ms long task (max of 2 runs) and an 8-chunk download cascade. It contains canvas state, image
  manipulation, and heavy WebAssembly/worker bridges (`@imgly/background-removal`). If Svelte
  cannot cut into that 1161 ms freeze in `image-editor`, the performance thesis of the entire
  migration fails. If it succeeds, users gain ~300–400 ms of main-thread responsiveness immediately.

#### Ranked Phase 4 migration table

Ordering rule: **measured main-thread long-task cost**, tie-broken by fewer
`@/features/appshell` imports. Only rows marked *measured* carry numbers from
`bun run perf:apps`; the rest are **unmeasured** and carry no figure, because a fabricated
millisecond value in a table is indistinguishable from a measurement once it is written down.
Measure a slice with `bun run perf:apps --apps="<label>"` before scheduling it.

Caution on the measured rows: `perf:apps` is a single-shot local diagnostic and its long-task
total moves a lot between runs on this host. Two consecutive runs of the same set gave
`Docs 112 / 71`, `Organization 195 / 163`, `Memory 129 / 78`, `Code 302 / 194`,
`Workflows 369 / 158`, `System Monitor 455 / 100` ms. Treat one figure as an order of magnitude,
not a rank-deciding constant; re-derive this table once the harness reports a median.

| Slice | LOC (§0) | Appshell imports (§0) | Long task, max of 2 runs (4× CPU) | Basis |
|---|---|---|---|---|
| `image-editor` | 6,966 | 0 | 1161 ms | measured |
| `system-monitor` | 759 | 4/14 | 455 ms | measured |
| `workflows` | 1,734 | 0 | 369 ms | measured |
| `video-editor` (`reel-editor`) | 6,539 | 3/62 | 362 ms | measured |
| `code-editor` | 1,782 | 0 | 302 ms | measured |
| `organization` | 889 | 2 | 264 ms | measured |
| `docs` | 220 | 3/4 | 239 ms | measured |
| `memory-graph` | 536 | 3/9 | 169 ms | measured |
| `os-terminal` | 1,482 | 4/15 | 142 ms | measured |
| `n8n`, `quicklinks` | 128, 83 | 2/4, 2/3 | not measurable (no dock icon) | — |
| `app-store`, `assistant`, `files-manager`, `icon-picker`, `managed-apps`, `os-settings`, `media-viewer`, `auth`, `os-shell`, remaining (§0) | — | — | — | unmeasured |

Do not rank by ms/kLOC here. Two slices show why: `docs` (220 LOC) and the smallest slices have
a denominator so small that run-to-run variance swamps the ratio, so a high ratio reflects a
small denominator rather than a big win. Choose by the absolute long-task column; use coupling
only to break ties between slices of similar size.

*(Note: `appshell` at 20,028 LOC is omitted here; it is the shell swapped in Phase 5.)*

Execution rules:
- One slice at a time, each behind a feature flag, each measured with `perf:apps`, each reversible.
- Freeze new React slice development only when > 50 % of `frontend/slices` bytes are Svelte.

Exit criteria: > 60 % of slice bytes are Svelte, `appshell` is the only large React
surface left, and no slice has regressed its Phase 0 baseline.

### Phase 5 — Shell swap (the only irreversible-feeling step)

- Only after Phase 4 exit criteria.
- SvelteKit takes over routing. The 4 pages + 1 layout are trivial; `appshell`
  (20,028 LOC, registry with `SlotRegion`, `FeatureDescriptor`, `ShellManifest`) is the work.
- Run both shells in parallel behind a host-level flag for at least one release cycle.
- Rollback = flip the flag back to the Next image. No database change, no cookie change.

Exit criteria: one full release cycle on SvelteKit with per-instance health green,
`proxy.ts` still in front (host rewrite, CSP, CSRF unchanged), and TBT measured at the
§3 target.

### Phase 6 — Rust sidecar (optional, independent of Phases 1–5)

- Port `proxy.ts` only (354 LOC + 3 test files). Measure with the Phase 0 harness.
- Prerequisite: prove proxy is a measurable share of CPU or TBT. It is not today
  (server TTFB 4–14 ms).
- Deliver as a sidecar/subprocess first, not a replacement — the CSP nonce path must stay
  byte-identical or the XSS containment layer breaks.
- Never port `lib/orchestration`.

### Rust HTTP core (speculative, separate decision)

Only if the 110 MB `next-server` RSS becomes a real hosting cost across three instances.
Then the Rust core serves Phase 2's portable handlers and SvelteKit becomes static assets
plus thin SSR. Do not attempt before Phase 2 lands.

---

## 5. Cost summary

| Path | Engineering | Risk to live users | Measured upside |
|---|---|---|---|
| Phase 0 (done) | 1 day | none | makes everything else falsifiable |
| **In-tree budget & mount tuning (§3 items 1–3)** | **2–5 days** | low | measured **−2.8 KiB gzip** from both eager leaks; LCP effect not yet detectable above the 3.2–4.2 s noise band |
| + Phase 1 (Bun tooling) | +2–4 days | none | dev velocity; `bun install` portability |
| + Phase 2 (portable core) | +2–3 weeks | none | maintainability, framework freedom |
| ~~+ Phase 3 (one island)~~ | ~~+3–4 weeks~~ | — | **cancelled by measurement**: a Svelte 5 island costs 15.75 KiB gzip of second runtime against a 1.64 KiB React chunk |
| Full Svelte (all phases) | **6–9 months solo** | medium | framework floor 132.7 → **33.07 KB gzip measured**; first-load 278.2 → **148–163 KB gzip** projected; TBT 164 → ~70–95 ms; LCP should follow the JS cut but is not yet measured on a real swap |
| Rust rewrite of shell + server | **> 1 year** | high | nothing user-visible |

The single honest sentence: **TBT is already at the post-migration target, but LCP is
3.2–4.2 s and hydration-bound to 942 KB of first-load JS; in-tree budget and mount fixes can
chip away at it, but cutting the runtime via migration is the primary path to ~2.5 s.**

After in-tree budget and mount tuning, Phases 1–2 are still worth doing on their own
merits (maintainability, `bun install` portability, a framework-free backend). Phase 3 was
the honest test of whether a slice could shrink first-load JS in a running shell; the spike
answered it negatively, so that budget moves to Phase 5. Phase 5 becomes the honest test of
whether the full swap brings LCP toward the ~2.5 s target, turning what looked like a bundle-aesthetics
exercise into a measurable user speed win.


---

## 6. How to reproduce these numbers

Perceived performance (steps 4 and 6 below) is now committed as Phase 0 scripts. The
rest are one-shot commands, kept here because the migration doc must be auditable, not
because they should be automated.

Perceived performance and per-app cost:

```
bun run perf:probe --base=http://127.0.0.1:4005      # table to stderr
bun run perf:hydration --base=http://127.0.0.1:4005  # hydration mark chain (FCP, last JS, mounted, icons, LCP)
node scripts/perf-probe.mjs --json > /tmp/perf.json   # machine-readable
bun run perf:check --report=/tmp/perf.json            # enforce budget
bun run perf:tasks --base=http://127.0.0.1:4005 --min-ms=40
bun run perf:apps  --base=http://127.0.0.1:4005
```

Without `--base=` each script starts its own synthetic `releaseFixture()`, so the gate is
runnable on a machine with no live instance.

Everything else:

1. `mso build` under `/usr/bin/time -v` (refuses to build in-place while the live runtime
   owns the checkout; it builds out of tree, so run it from outside the repo).
   → total wall time and peak RSS in §1.1.
2. `npx tsc --noEmit`, `npx vitest run`, `npx vitest run lib/mcp`, `bun test lib/mcp`.
3. `.next/diagnostics/route-bundle-stats.json` + `scripts/check-bundle.mjs --report-only`
   for the bundle table.
4. `curl -w` against `/`, `/api/status`, `/api/v1/apps` for TTFB.
5. `ps -eo rss` over the `next-server` + `scripts/server.mjs` processes for RSS.

Measurement pitfalls found while building Phase 0, kept because each one produced a
wrong number first:

- 200 kbps is Slow **3G**; the shell then takes ~37 s to arrive and you measure the
  network. Lighthouse Slow 4G is 1.6 Mbps down / 750 kbps up / 150 ms RTT.
- `#main-content` exists in the server-rendered skeleton, so waiting for it measures an
  82-node pre-hydration frame. Wait for `#main-content[data-shell]`.
- `data-shell` is `macos` on desktop and `ios` on mobile; a hardcoded value hangs the
  mobile run.
- LCP arrives ~3 s in. A "settle when nothing changes for 1 s" loop exits too early and
  reports `lcpMs: null`.
- TBT is `Σ max(0, duration − 50)`, not the raw sum of long-task durations.
- **Retracted again:** concluding that LCP was paint-bound from a single LCP element tag
  (`SPAN`/`IMG`) is wrong — the element that ends up largest can be painted late by JS,
  so the element identity says nothing about what gates it; measure the mark chain
  (`perf:hydration`) instead.
