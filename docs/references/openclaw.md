# openclaw/openclaw

| | |
|---|---|
| License | MIT |
| Relation | managed application; product comparison peer |
| Code copied | none |

## What MSO uses

A managed-app adapter only: unit names, container names, dashboard URL and state
directory in [`../../lib/managed-apps/catalog.ts`](../../lib/managed-apps/catalog.ts),
documented in [`../OPENCLAW-INTEGRATION.md`](../OPENCLAW-INTEGRATION.md).
`docs/PROGRESS.md` records one security fix that keeps OpenClaw provider keys out of
argv — an MSO-side hardening of how MSO launches a third-party process.

## Comparison boundary

[`../COMPARISON.md`](../COMPARISON.md) and [`../COGNITIVE-RUNTIME.md`](../COGNITIVE-RUNTIME.md)
name OpenClaw as a peer. Where a matched provider/model path was not available, the
benchmark emits no ranking rather than an unfair one, and MSO does not edit
OpenClaw's configuration to create comparability.

## Evidence

No OpenClaw source, prompt, skill or asset is present in this repository. Integration
code is limited to lifecycle, logging and health surfaces MSO already owns.
