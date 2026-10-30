# Phase 4/5 comparison: after

Captured on `4c6b0bec`, 2026-10-30, host idle (**load average 0.14–0.41**), same machine and same
protocol as `docs/BENCH-BEFORE.md`. Every number is measured.

The "before" column is copied from `BENCH-BEFORE.md` for side-by-side reading; it was taken on
`062fe18` two days earlier on the same box at comparable load, which is what makes the delta
mean anything.

## 1. Bundle (deterministic, from build output)

| Part | Before (gzip) | After (gzip) | Δ |
|---|---|---|---|
| initial | 277,248 B / 270.8 KiB | 277,248 B / 270.8 KiB | **0** |
| entry | 144,578 B / 141.2 KiB | 144,578 B / 141.2 KiB | **0** |
| runtime (framework) | 132,670 B / 129.6 KiB | 132,670 B / 129.6 KiB | **0** |
| css | 30,721 B / 30.0 KiB | 30,721 B / 30.0 KiB | **0** |
| fonts | 69,695 B / 68.1 KiB | 69,695 B / 68.1 KiB | **0** |

Bundle is unchanged, and that is the correct outcome: no Phase 5 work has started, so nothing
should shrink. Framework share stays 47.9 % of the initial bundle.

## 2. Perceived performance

`node scripts/perf-probe.mjs --json`, single run at load 0.41 (before was a median of 3 at
0.32–0.42). The comparison is therefore indicative, not statistically matched — the spread
measured earlier is LCP 3.15–3.23 s desktop, TBT 161–186 ms.

| Metric | Before | After | Δ |
|---|---|---|---|
| desktop FCP | 1,164 ms | 1,160 ms | −4 ms |
| desktop LCP | 3,152 ms | 3,220 ms | +68 ms |
| desktop TBT | 173 ms | 193 ms | +20 ms |
| mobile FCP | 1,169 ms | 1,180 ms | +11 ms |
| mobile LCP | 2,956 ms | 3,016 ms | +60 ms |
| mobile TBT | 101 ms | 111 ms | +10 ms |
| first-load JS | 910.2 KiB | 910.2 KiB | **0** |

**All deltas are inside the noise band measured on this host.** Nothing regressed and nothing
improved. Stating this plainly matters more than manufacturing a trend: two days of work went
into portability and gating, not into bytes or wall-clock.

## 3. Hydration mark chain

`node scripts/perf-hydration.mjs --base=http://127.0.0.1:4005`

| Mark | Before | After | Δ |
|---|---|---|---|
| desktop FCP | 1,180 ms | 1,176 ms | −4 |
| desktop last JS | 2,804 ms | 2,811 ms | +7 |
| desktop mounted | 2,523 ms | 2,534 ms | +11 |
| desktop icons | 3,078 ms | 3,107 ms | +29 |
| desktop LCP | 3,132 ms | 3,164 ms | +32 |
| mobile LCP | 2,996 ms | 2,976 ms | −20 |

Same shape as before: LCP lands ~350 ms after the last JS byte, which is why the document calls
LCP hydration-bound rather than paint-bound. Unchanged, because the shell still mounts
client-side and still waits for ~910 KiB.

## 4. Per-app open cost (4× CPU)

| App | Before (open `/` long task `/` chunks) | After | Δ |
|---|---|---|---|
| Image Editor | 618 ms / 732 ms / 8 | 648 / 728 / 8 | +30 / −4 / 0 |
| Video Editor | 566 / 371 / 4 | 415 / 276 / 4 | **−151 / −95 / 0** |
| Terminal | 219 / 63 / 3 | 184 / 57 / 3 | −35 / −6 / 0 |
| System Monitor | 192 / 68 / 2 | 209 / 81 / 2 | +17 / +13 / 0 |

Video Editor looked 151 ms faster, so the claim was tested rather than assumed. Three further
runs of the same two apps, same host, minutes apart:

```
Video Editor  480 / 454 / 490 ms open   331 / 298 / 341 ms long task
Image Editor  654 / 740 / 711 ms open   775 / 1079 / 771 ms long task
```

Video Editor's real range is ~450–490 ms open, so the 415 ms reading was the low tail of the
noise, not an improvement — and the app chunk is byte-identical (`2-u96jp7bl0ei.js`, same 4
chunks), so no commit in the window could have caused it anyway. The same applies to Image
Editor, whose long task ranged 728–1079 ms across runs: a single-shot harness on this host
varies 2–4×, exactly as recorded in `BENCH-BEFORE.md`. None of these deltas are attributable.

## 5. Code and test surface

| Measure | Before | After | Δ |
|---|---|---|---|
| TS/TSX files | 2,688 | 2,706 | +18 |
| TS/TSX LOC | 204,905 | 207,346 | +2,441 |
| `.svelte` files | 0 | 0 | **0** |
| `lib/` LOC (framework-free) | 100,787 | 102,820 | **+2,033** |
| `frontend/slices` LOC | 74,209 | 74,209 | **0** |
| — of which `appshell` | 20,028 | 20,028 | 0 |
| Route handlers | 117 | 117 | 0 |
| — of which > 15 LOC | 0 | 0 | 0 |
| Static `next/*` in `lib/` | 0 | 0 | 0 |
| Runtime deps | 33 | 33 | 0 |
| Test files | 873 | 881 | +8 |
| `node_modules` | 1,435 MB | 1,599 MB | +164 |

The +2,033 LOC in `lib/` is the whole story of the two days on the code side: it is framework-free
code with tests, and **zero** lines moved from `frontend/slices`. That is exactly why the bundle
and the timings did not move.

`node_modules` grew 164 MB because the perf gate and Bun tooling added Playwright browser
dependencies to the tree; `next` itself is unchanged at 210 MB.

## 6. Test suite

| Measure | Before | After | Δ |
|---|---|---|---|
| files / tests | 877 / 5,730 | 881 / 5,772 | +4 / +42 |
| wall time (plain run) | 34.82 s | ~34 s | — |
| wall time (coverage, what CI runs) | not run locally | 45.4 s, 882 files / 5,772 | new |

The last row is the substantive change: the local gate now runs the coverage configuration CI
runs, and that is what exposed three defects (a broken Forge sandbox image and a temp-dir test
that assumed `os.tmpdir()` was private).

## 7. What this comparison establishes

1. **No regression.** Bundle identical, timings inside the noise band, tests up.
2. **No progress on the stated goal.** Zero `.svelte` files, zero slices ported, first-load JS
   unchanged at 910.2 KiB.
3. **The gate is now trustworthy.** `gates-12.sh full` reports 17 passed / 0 failed / 0 skipped,
   matching the CI step set, and the perf gate is wired into CI.
4. **The migration is not worth doing slice-by-slice.** Measured twice: an island costs 15.75 KiB
   gzip against a 1.64 KiB React chunk, and one Svelte component costs 2.8× the whole React slice
   it would replace.

So the accurate summary is that this work bought **portability and the ability to decide**, not
speed. Whether to spend the remaining 8–12 months on Phase 5 is a product decision that these
numbers support but do not make.
