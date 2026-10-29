# Phase 4/5 comparison: before

Baseline captured on `062fe18`, host idle (**load average 0.15–0.42**), 2026-10-29.
Every number here is measured, not estimated. "After" columns stay empty until the work lands.

Regenerate with the commands named under each table.

## 1. Bundle (deterministic, from build output)

`node scripts/check-bundle.mjs --json`

| Part | Raw bytes | Gzip bytes | Gzip KiB | Files |
|---|---|---|---|---|
| initial | 870,887 | 277,248 | 270.8 | 18 |
| entry | 426,778 | 144,578 | 141.2 | 13 |
| runtime (framework) | 444,109 | 132,670 | **129.6** | 5 |
| css | 188,715 | 30,721 | 30.0 | 2 |
| fonts | 69,652 | 69,695 | 68.1 | 1 |

Heavy eager modules (`ReactFlow`, `Konva`, `Xterm`, `ONNX`) leaking into the first-load graph: **0**.
Next version measured: 16.4.2.

Framework share of the initial bundle: 132,670 / 277,248 = **47.9 %**.

## 2. Perceived performance (Slow 4G + 4× CPU, browser)

`node scripts/perf-probe.mjs --json`, 3 runs. Median shown; range in brackets.

| Metric | Desktop 1440×900 | Mobile 390×844 |
|---|---|---|
| FCP | 1,164 ms (1,160–1,168) | 1,169 ms (1,164–1,172) |
| **LCP** | **3,152 ms** (3,152–3,232) | **2,956 ms** (2,952–3,028) |
| **TBT** | **173 ms** (161–186) | **101 ms** (90–114) |
| first-load JS | 910.2 KiB | 894.1 KiB |

## 3. Hydration mark chain

`node scripts/perf-hydration.mjs --base=http://127.0.0.1:4005`

| Mark | Desktop | Mobile |
|---|---|---|
| FCP | 1,180 ms | 1,160 ms |
| last JS byte | 2,804 ms | 2,746 ms |
| shell mounted | 2,523 ms | 2,529 ms |
| icons painted | 3,078 ms | 2,963 ms |
| **LCP** | **3,132 ms** | **2,996 ms** |
| LCP element | `SPAN` (menu-bar label) | `IMG` (app artwork) |
| mount after FCP | +1,343 ms | +1,369 ms |
| LCP after FCP | +1,952 ms | +1,836 ms |
| LCP after last JS | +328 ms | +250 ms |

The chain is the reason LCP is what it is: the shell mounts only after ~910 KiB of JS has
arrived and executed, and LCP lands after that. LCP is **hydration-bound**, not paint-bound.

## 4. Per-app open cost (4× CPU, cold context per app)

`node scripts/perf-app-open.mjs --base=http://127.0.0.1:4005`

| App | Open | Chunks pulled | Long task |
|---|---|---|---|
| Image Editor | 618 ms | 8 | 732 ms |
| Video Editor | 566 ms | 4 | 371 ms |
| Terminal | 219 ms | 3 | 63 ms |
| System Monitor | 192 ms | 2 | 68 ms |

## 5. Code and test surface

| Measure | Value |
|---|---|
| TS/TSX files | 2,688 |
| TS/TSX LOC | 204,905 |
| `.svelte` files | **0** |
| `lib/` LOC (framework-free since Phase 2) | 100,787 |
| `frontend/slices` LOC | 74,209 |
| — of which `appshell` | 20,028 |
| Route handlers | 117 |
| — of which > 15 LOC | **0** |
| Static `next/*` imports in `lib/` | **0** |
| Runtime dependencies | 33 |
| Dev dependencies | 18 |
| `node_modules` | 1,435 MB |
| — of which `next` | 210 MB |
| Test files | 873 |
| Test wall time | **34.82 s**, 877 files / 5,730 tests, 380 MB RSS |

## 6. What this baseline says about the remaining work

From `docs/MSO-MIGRATION.md` §5, with the appshell inventory measured in §4 Phase 5:

```
framework floor now            132,670 B gzip  (129.6 KiB, 47.9 % of initial)
framework floor if swapped     33,070 B gzip   (§2.1, measured in a real build)
first-load JS now              910.2 KiB       (browser-measured)
first-load if swapped          ~150-165 KiB    (projected, app code 115-130 KiB)

appshell to re-express         20,028 LOC   => 166-239 days
slices to re-express           54,181 LOC   => 452-677 days
```

That is the "after" target this comparison will be measured against. It is 618–916 days of
work, so this document tracks increments, not a single leap.
