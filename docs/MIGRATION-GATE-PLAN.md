# Migration gate plan (aligned with docs/MSO-MIGRATION.md)

Written before implementation. The migration doc is the authority: it says do NOT rewrite
before the §3 gate, and §3 is an ordered list of cheap in-tree wins. So this branch does the
gate work, not a framework swap.

## What the other agent already landed on main

- `c795f0b` Phase 0 instrumentation: `perf:probe`, `perf:check`, `perf:tasks`, `perf:apps`,
  `perf:hydration`, `scripts/perf-budget.json`, `scripts/perf-baseline.json`.
- `6c8933c` hydration mark chain, and the retraction of the "LCP is paint-bound" claim.
- Conclusion now recorded: LCP is hydration-bound to ~942 KB first-load JS; TBT 164 ms is
  already at the post-migration target.

## My own regression to fix first

`lib/agent/session-compact-now.ts` (shipped in #166) imported `next/server`, which violated
the Phase 2 exit criterion "zero `next/*` imports in `lib/`".

**Superseded while this branch was in review.** Commit `c846bc7` on `main` fixed the same
debt for every `lib/` file by switching `NextResponse` to the platform `Response`. That is
the better fix, so my version (moving the route shape into `app/`) was dropped during the
rebase rather than merged as a second, competing shape. Nothing of mine remains in that
area, and the criterion is now met upstream.

## §3 items, cheapest first

| # | Item | Concretely | Status |
|---|---|---|---|
| G-1 | Shrink the eager graph and lock a measured baseline | done upstream by `e8cddb3`: arithmetic budget (initial 290819, entry 158149, css 31319 from a measured floor + 2% headroom), and the 250 KiB target demoted to a post-migration goal | landed upstream, not here |
| G-2 | Keep app artwork off the LCP critical path | hidden platform variants taken out of layout/paint; markup untouched | landed here |
| G-3 | Cut shell mount cost | done upstream by `e8cddb3` and `9d2dc93` (two eager leaks closed); the Svelte island spike was also run and cancelled there | landed upstream, not here |
| G-4 | Phase 2 debt: zero `next/*` in `lib/` | done upstream by `c846bc7` (Response instead of NextResponse); my duplicate attempt was dropped | landed upstream, not here |

### Why this branch only carries G-2

While it was open, `main` moved three times and each move landed a piece of §3 more
thoroughly than this branch had:

- `c846bc7` fixed the `lib/` framework debt for every file at once (platform `Response`
  instead of `NextResponse`), which is better than moving route shapes into `app/`.
- `9d2dc93` and `e8cddb3` closed two eager leaks and rebuilt the bundle budget from a
  measured framework floor plus 2% headroom, and demoted the 250 KiB figure to a
  post-migration goal. That is the honest version of the item I had marked blocked.
- `e8cddb3` also ran the Svelte island spike and cancelled it on measurement.

So the duplicate work was dropped during rebase rather than merged as a competing
second shape. What remains here is the one item upstream had not touched: the hidden app
artwork variants that still pay layout and paint cost on every app tile.

### G-2 evidence

`frontend/slices/os-shell/brand-marks.tsx` renders three artwork variants per app (15 apps,
496 KB of WebP under `public/app-icons`), two of which CSS always hides. The markup cannot
choose one: the shell family is only known after hydration, and choosing at SSR risks a
hydration mismatch for a decorative image. What it can do without guessing is stop the
hidden variants from doing layout and paint work, so `globals.css` uses
`content-visibility: hidden` for the hidden variants and restores `visible` when the
matching `[data-shell]` rule makes one of them shown. `loading="lazy"` was deliberately NOT
used: the iOS/macOS variant is the mobile LCP element, and demoting it would trade one
regression for another.

**What is measured and what is not.** The bundle is unchanged (882.0 KiB raw / 281.0 KiB
gzip; css 30.0 KiB gzip), so this changes layout and paint work, not bytes. The LCP mark
chain was run against the live `:4005` service, which still serves the pre-change build:

```
desktop  fcp 1184ms  mounted 2607ms  icons 3191ms  lcp 3252ms (SPAN)  js 941.7KB
mobile   fcp 1152ms  mounted 2585ms  icons 3002ms  lcp 3040ms (IMG)   js 925.5KB
```

Those numbers describe the old build, so they cannot be presented as the effect of this
change. What they do show is that `icons` (the artwork paint step) still lands before LCP
on both surfaces, i.e. the step this change touches is on the measured path. Attributing a
delta would require measuring the deployed build, and this branch is not deployed.

## Rules I hold myself to

- No user-visible UX change. No second login, cookie domain, or dropped deep link.
- No ratchet raised. `filesOver220`, `serverFrontendImports`, cycles stay equal or lower.
- Every claimed improvement is a measurement, not a vibe. If a number cannot be measured
  on this host, say so instead of quoting one.
- Do not quote the migration doc's numbers as mine; re-measure or label them as quoted.

## Gate

Targeted tests, `check-architecture`, `check-docs`, `pr-preflight --local`,
`pr-preflight --security`, `perf:check` where it applies, then a draft PR.
