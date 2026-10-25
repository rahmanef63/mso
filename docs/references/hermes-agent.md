# NousResearch/hermes-agent

| | |
|---|---|
| License | MIT |
| Relation | one of MSO's two managed applications; benchmark peer |
| Code copied | none |

## What MSO uses

A managed-app adapter: [`../../lib/managed-apps/catalog.ts`](../../lib/managed-apps/catalog.ts)
declares the dashboard and gateway units, container names, dashboard URL, health
path and state directory. [`../HERMES-INTEGRATION.md`](../HERMES-INTEGRATION.md)
records the runtime identity and the rule that MSO does not scrape the vendor SPA
into launcher items.

Hermes is also a comparison peer in [`../COGNITIVE-RUNTIME.md`](../COGNITIVE-RUNTIME.md)
and the `bench:agents` corpus. [`../PROGRESS.md`](../PROGRESS.md) records that
comparison is refused when provider/model evidence does not match, and that MSO does
not mutate a competitor's credentials to manufacture comparability.

## What MSO uses from the sibling, and why it is not copying

`scripts/managed-app-install` writes `hermes-dashboard.service` itself because
upstream ships no installer for that unit. That is MSO's own unit file for a
third-party process, not an upstream file.

## Evidence

Shingle comparison of 2,496 MSO source files against 7,221 Hermes source files: the
only overlaps above 0.20 are `sheet.tsx`, `popover.tsx`, `dialog.tsx`, `scroll-area.tsx`
— shadcn/ui primitives present in both repositories from their own initial commits.
No Hermes module was transplanted.
