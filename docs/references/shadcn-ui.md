# shadcn-ui/ui

| | |
|---|---|
| License | MIT |
| Relation | UI primitives used across the shell and slices |
| Code copied | yes, as generated component source |

## What MSO uses

`components/ui/*` is shadcn/ui component source, generated into the repo by the
shadcn CLI and then owned locally. `components.json` pins the preset
(`style: new-york`, `baseColor: neutral`, `cssVariables: true`, alias `@/components/ui`).
Twelve primitives (card, dialog, select, popover, input, textarea, skeleton,
input-group, command, scroll-area, button, badge) are present.

Slivers that need behaviour upstream does not ship are vendored beside the slice
rather than by forking the shared component; `frontend/slices/image-editor/ui/`
holds local `slider.tsx` and `tabs.tsx` variants.

## Attribution

shadcn/ui is distributed as copy-in source precisely so it can be owned by the
consumer. MSO's root [`../../LICENSE`](../../LICENSE) covers the MSO repository; the
upstream MIT text is not duplicated per file because the convention for this library
is to copy components in as application source, which MSO has done since commit
`71a4303` (2026-08-02).

## Note on the Nakama comparison

Parity work on 2026-10-18 did not introduce these files. Any file-overlap result between
MSO and Nakama or Hermes that lands on `components/ui/*`, `sheet.tsx`, `popover.tsx`,
`dialog.tsx` or `scroll-area.tsx` is shared shadcn descent, not transfer between those
projects.
