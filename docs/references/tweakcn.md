# jnsahaj/tweakcn

| | |
|---|---|
| License | Apache-2.0 |
| Relation | bundled theme preset registry |
| Code copied | data, not code |

## What MSO uses

`lib/appearance/presets/registry-data.json` is a 239 KB, 36-preset mirror of the
tweakcn registry (`name: tweakcn-theme-registry`, `homepage: http://tweakcn.com`).
`scripts/check-contrast.mjs` validates every preset in that file, so the mirror is
load-bearing, not decorative. [`../PROGRESS.md`](../PROGRESS.md) calls it a
"verbatim upstream mirror".

## Obligation

Apache-2.0 §4 requires the notice and license text to travel with a redistributed
work. Attribution is recorded in `lib/appearance/presets/registry.ts`; the full
Apache-2.0 text is not vendored here. The registry content is a data file, not a
modified source tree.

## What MSO does not use

No tweakcn editor, React components, or build tooling. `lib/appearance/presets/apply.ts`
maps preset tokens onto MSO's own chrome variables.
