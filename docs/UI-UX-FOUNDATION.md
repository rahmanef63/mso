# Dynamic MSO interface contract

Required contributor rules for every feature live in [FRONTEND-CONTRACT.md](./FRONTEND-CONTRACT.md).
This document describes the implementation seams; it does not claim every feature is migrated.

This is a refinement of the existing five shell identities in DESIGN.md. Shell chrome remains
platform specific; feature behaviour and state are shared. No new adapter or backend provider
has been added. Public MCP tools and authorization remain unchanged.

## Configuration and ownership

| Level | Owner | Contract |
| --- | --- | --- |
| Shell | ShellManifest.layout | Per-shell pagePadding, gap, controlHeight, controlPadding and sidebarWidth |
| Feature | AppFrame.layout | Optional local metric overrides; padded=true opts a scrolling content body into page spacing |
| UI kit | Button, Input, responsive dialog parts | Inherits semantic CSS metrics, with coarse-pointer minimum targets |

All configuration values are finite positive CSS pixel dimensions up to 512, converted to rem.
CSS variables are `--feature-padding`, `--feature-gap`, `--feature-sidebar-width`,
`--ui-control-height` and `--ui-control-padding`. Root variables also reach portalled UI.
The same-origin Integrations bridge copies only reviewed presentation tokens into its iframe.
Feature containers still own their breakpoints. A compact window on a desktop must behave
like a compact panel; it must not infer layout from the outer monitor width.

```tsx
const manifest: ShellManifest = {
  brand, apps, features,
  layout: { windows: { pagePadding: 24, sidebarWidth: 248 }, ios: { controlHeight: 44 } },
};
// A feature may override inherited values without changing other windows.
<AppFrame padded layout={{ pagePadding: 16, gap: 8 }}>...</AppFrame>
```

Default controls: macOS/Windows/Dashboard 36 px, iOS 44 px, Android 48 px.
Coarse-pointer buttons and inputs keep at least a 44 px target. Dense, intentionally sized
variants can preserve desktop chrome proportions. Canvas features keep padded=false.
Metric overrides are code configuration, not a new settings editor or remote preference API.

## Feature state

`useFeatureState(winId, key, initial)` keeps ephemeral UI state owned by an exact window.
Desktop, mobile and dashboard mounts read the same snapshot; window closure prunes it.
State is not written to disk or shared across users. Workflows uses this for drafts, selected
nodes, runs, library mode, sessions, filters and details. Async updates after window closure
are ignored. Browser reload still requires saving the workflow; the unsaved guard explains
that boundary. Other features may adopt the hook; this does not claim every local state hook
in the application has been migrated.

Mobile iOS and Android now pass the exact window ID to feature content, just like desktop
and Dashboard. A restored external-app URL is retained while its asynchronous registry loads;
an unavailable descriptor cannot silently rewrite that route to Home.

## State and geometry

Window preferredRect stores user intent. Rendered x/y/w/h are a projection into the current
work area. Viewport changes do not overwrite preferredRect. Explicit moves update position
without losing a width constrained by a temporary viewport; explicit resizes update size.
Snap/maximize preserve the normal rectangle. Reflow includes minimized windows and publishes
one store notification for a batch, with none when nothing changed.

Legacy saved arrays remain supported. Invalid geometry, invalid snap zones, duplicate IDs and
unsafe object keys are discarded per entry. Boot hydration still merges under deep-link
windows. Persistence stays browser-local and flushes pending snapshots on pagehide,
visibility-hidden and hook cleanup. Storage quota/private mode failures remain nonfatal.

Desktop widget positions are projected into measured container bounds without replacing their
saved positions on resize. Oversized widgets scroll internally. Pointer cancellation and lost
capture cancel dragging; pointer-up computes its final movement from the event coordinates.

## Feature corrections

- Integrations: solid sidebar background; one sidebar scroll; full owner picker header;
  container-based initial inert state measured before visual transforms; resized panes reset navigation correctly; old observers
  disconnect on redraw; credential fields use three desktop columns with grouped icon actions; duplicate source badges
  collapse; Composio tools/session use progressive disclosure.
- Manager readiness: the iframe posts a ready event after mounting. Parent accepts the exact
  event only from that iframe and the same origin. A non-empty iframe src is not success.
- Workflows: separate no-automation and no-match copy, Clear filters, real View sources action,
  and confirmation before discarding changes on close, reload or changing workflow/session.
- Dialogs/drawers/sheets: semantic opaque surfaces and inherited feature spacing.
- Dock: 36 px icon floor, overflow scrolling, no magnification for touch or reduced motion.
- n8n: pending requests abort on replacement/unmount; initial loading differs from not-configured;
  external frames reset on URL changes and retain Open plus an origin-home fallback.
- System Monitor: live sessions show real CPU/memory/disk. GPU simulation is limited to demo mode.

## Verification and operational limits

Targeted regression tests cover viewport/reload/maximize/minimize round trips, atomic updates,
legacy cache validation and layout inheritance. Existing deep-link, shell, Integrations and
dock tests remain in the validation set. Typecheck, lint and a separate-clone preview build
passed during implementation. Full repository and security gates must be recorded against
the final committed SHA before claiming PR readiness.

Browser checks use a disposable release fixture with synthetic credentials and private stores.
They must inspect actual readiness, keyboard access, scroll bounds and both themes, rather
than infer correctness from source strings or an iframe load event.

The reviewed external n8n route previously returned 404 and SAMEORIGIN. A frontend fallback
does not repair a third-party route or override its frame policy. Missing provider setup and
uninstalled apps from the feature audit remain installation/configuration facts. No deployment,
provider credential changes, external security-header weakening or production session changes
are part of this local implementation. Shipping follows the repository's main/release path
after the operator authorizes push/PR/merge.
