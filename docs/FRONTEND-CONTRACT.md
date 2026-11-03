# MSO frontend implementation contract

> Current reference for every agent and contributor changing a visible MSO surface.
> Applies to `frontend/`, `app/`, shared UI, and native HTML/CSS/JS surfaces in `lib/`.
> This is a required implementation/review contract, not a claim that every existing
> feature already meets every rule. Record adoption and evidence per changed feature.

## Read before changing a feature

1. Read root `AGENTS.md` and `CLAUDE.md` for source, host, permissions and release rules.
2. Read [`DESIGN.md`](../DESIGN.md) for the established product direction and semantic tokens.
3. Read this contract and [`UI-UX-FOUNDATION.md`](./UI-UX-FOUNDATION.md) for shared layout/state.
4. Read [`Shell UI architecture`](../frontend/slices/appshell/design/README.md) and the
   affected shell's local `design.md`; preserve all five shell identities.
5. Read the feature's own contract and find a working sibling implementation.
   [`SLICE-CATALOG.md`](./SLICE-CATALOG.md) is the feature inventory SSOT.
6. Follow [`ARCHITECTURE.md`](./ARCHITECTURE.md); run its ratchet before adding a seam.

For a whole-product request, inventory every registered feature before narrowing changes.
Mark each item as fixed, verified unchanged, configuration-blocked, or not yet verified.
A shared primitive improvement does not prove all consumer journeys were exercised.

## Ownership: shell, feature, UI kit

| Layer | Owns | Required seam |
|---|---|---|
| Shell | Platform chrome, work area, typography, native navigation, default metrics | `ShellManifest.layout`, active design profile and `LayoutBoundary` |
| Feature | Content hierarchy, local override, loading/data/error states, feature actions | `AppFrame`, optional `layout` and `padded`, container-driven navigation |
| UI kit | Control geometry, semantic colour, focus, disabled/busy states, dialogs | Existing shared components and inherited metrics |

Do not fork API calls, validation, permission logic or durable state by operating system.
Mobile shells own feature navigation: one shell header, centered title and the established
back/AI actions. Do not add a second competing mobile feature header.
Use `ResponsiveDialog`/`FormDrawer` for native shell presentation unless a documented feature
need requires an override. Portals must inherit the active layout and theme boundary.
Native DOM surfaces use their existing shared DOM components and the reviewed token bridge;
do not import React frontend components into server infrastructure.

## Layout, padding and responsiveness

- Inherit `--feature-padding`, `--feature-gap`, `--feature-sidebar-width`,
  `--ui-control-height` and `--ui-control-padding`. Put reusable defaults at the shell or
  UI-kit layer, feature-specific exceptions on `AppFrame.layout`, not in every consumer.
- Use semantic spacing/type/colour tokens. New literal values need a feature-specific reason;
  do not add another global scale or scatter OS checks through feature components.
- Opt into page spacing with `padded`; editors, terminal and canvases can remain edge-to-edge.
- Adapt to the **feature container**, including a narrow desktop window. Viewport width alone
  cannot decide whether a feature sidebar is inline or a drawer.
- Constrain flex/grid children with `min-width:0` and `min-height:0` where necessary. Assign
  one intentional scroll owner per region; avoid clipped controls and accidental nested scroll.
- Long names, URLs, translated copy and real empty data must wrap or truncate with a way to
  recover the full value. Essential actions cannot disappear offscreen.
- Respect mobile safe areas, portrait/landscape, software keyboard, touch and larger text.
  A canvas may scroll internally; the whole document must not acquire accidental overflow.
- Fine-pointer dense desktop controls may follow shell metrics; touch targets must be at least
  44 CSS px. Do not shrink tap targets merely to preserve a desktop row on a phone.
- Preserve intended window/widget geometry separately from constrained rendered geometry.
  Resizing the viewport must not permanently overwrite the user's preferred position/size.

## State and asynchronous work

- Name the owner and lifetime of state: local interaction, exact window, URL, persisted user
  preference, durable feature record or server response. Do not conflate these identities.
- Use `useFeatureState(winId, key, initial)` when ephemeral state must survive shell remounts.
  Forward the same window ID through desktop, Dashboard, iOS and Android. Closing the window
  clears that state; browser reload does not imply unsaved drafts are durable.
- Use the existing feature store/API for durable data. Never persist secrets in localStorage,
  duplicate a second store, or store sensitive data merely to preserve a visual state.
- Drafts need explicit save/discard behaviour and an unsaved-change guard at the relevant
  close, route, record and reload boundaries. State from one window/owner cannot bleed into another.
- Abort superseded requests and unmounted effects, or ignore results with a sequence/identity
  guard. Changing selected owner/provider/project must not display a late result for the old one.
- Prevent duplicate writes, show pending feedback, handle rejection and restore retry controls.
  Optimistic updates need a defined rollback. A completed request must update the canonical state.
- Distinguish initial loading, empty data, no filter matches, error, unavailable service and
  permission denied. A timeout or iframe load event alone is not successful readiness.
- URL/deep-link restoration must wait for asynchronous feature/connected-app registration.
  Keep the existing History API routing contract; do not force full shell remounts for focus.
- Persist through the repository's validated schema and flush lifecycle. Malformed cache,
  storage failure and legacy state must degrade without breaking the feature.

## Actions, menus, forms and copy

- Every visible interactive control must perform its stated action. No placeholder buttons,
  fabricated measurements, false success, invented security claims or demo data presented as live.
- Use icons for familiar repeated utilities such as reveal, copy, delete and overflow. Give
  icon-only controls a precise accessible name and tooltip. Decorative SVGs are hidden from AT.
- Keep text for primary/unfamiliar actions and for dropdown items; leading icons aid scanning.
  Dropdown triggers expose open/closed state. Preserve keyboard opening, Escape, outside close
  and focus return. Do not claim ARIA menu semantics without implementing its keyboard model.
- Reveal/copy secrets only after a human action. Keep Copy masked, provide feedback and discard
  temporary values on hide, timeout or failure. Never put secret values in labels, logs or URLs.
- Destructive actions keep the established confirmation, exact target and permission check.
  Cancel restores focus to that target or the closed trigger, not an arbitrary matching icon.
- Forms have associated labels, field-specific errors, useful validation and predictable submit
  behaviour. Explain disabled/unavailable actions when the reason is not obvious.
- Use plain, task-specific copy. No user-visible em dash. Empty and failure states offer a real
  recovery action where the feature can provide one.
- UI filtering is not authorization. Preserve server role checks and fail-closed permissions.
  Do not weaken iframe, origin, filesystem or service policy to make a preview appear successful.

## Accessibility, theme and motion

- Both shipped themes use semantic colours and WCAG AA text contrast. Run the contrast gate;
  also inspect the rendered composition, since token checks alone cannot prove every overlap.
- Support keyboard-only navigation, visible focus, meaningful headings/landmarks and labels.
  Dialog/drawer focus is contained while open; background regions are inert where appropriate.
- Use the correct native element before adding ARIA. Announce asynchronous status without
  repeatedly stealing focus. Status must not depend only on colour or an unlabeled icon.
- Respect reduced motion, touch input and larger text. Avoid motion that changes the effective
  layout measurement or prevents access to a control during an animation.
- Loading/skeleton states preserve meaningful hierarchy without masquerading as real data.

## Feature-specific acceptance

The same contract applies to every family below; use the catalog for exact feature ownership.

| Feature family | Additional journey to verify |
|---|---|
| Files, terminal, code and host tools | Selection/path/session identity, resize, scroll, keyboard, permission failure and real error recovery |
| Assistant, channels, agents, managed runtimes | Conversation/turn identity, stream cancellation, activity state, reconnect and unavailable runtime |
| Workflows, Organization, Memory and canvas/media editors | Draft/save/discard, selection, canvas bounds, filters, undo where supported and reload boundaries |
| Settings, Integrations and infrastructure | Owner/project scope, input validation, pending/error state, secrets, confirmation and long menus |
| Browser, n8n and external/connected apps | Ready handshake, denied embedding, failed route, reload, external-open fallback and origin isolation |
| Store, Create, Quicklinks, Docs and pickers | Empty/search/no-match, valid navigation, real action completion and focus return |
| Shell, authentication and lock surfaces | Five-shell transitions, deep links, locked privacy, safe areas, portals and restored/minimized windows |

## Verification and definition of done

1. Reproduce the original problem; preserve the first error or screenshot and identify the real
   repository/runtime. Choose the smallest authoritative reversible fix.
2. Add behaviour tests for state or interaction regressions. Do not add tests that only mirror
   cosmetic markup. Wire important journeys into existing mandatory gates.
3. Inspect the actual frontend using synthetic fixtures for sensitive writes. Follow the operator's
   chosen design/browser tools. When pen.dev MCP and Browser are requested, use those surfaces;
   do not take over the native desktop. Keep source edits in the authorized checkout.
4. For changed shared layout/state, inspect all five shells and both themes. For local feature
   changes, inspect the affected shell contexts plus representative desktop, narrow window and
   mobile sizes. Record exact sizes, larger-text checks and keyboard behaviour. Continuous CSS
   support is the goal; finite samples are not proof of every possible resolution or real device.
5. Check loading, empty, no-match, error, permission, pending and success states that apply.
   Include a route/reload or shell-remount round trip when the changed state promises to survive it.
6. Run targeted tests, architecture/docs/contrast gates and the repository-required full local,
   security and remote checks on the exact committed SHA. A build pass alone is insufficient.
7. In the PR/final report include: feature and owner, before/after, affected layers, state lifetime,
   shell/theme/viewport evidence, test results, untested paths, external configuration limits and
   deployed SHA if released. Mark blocked or unverified items honestly; do not call them fixed.
8. Ship through the canonical main/release path in root instructions. Preserve rollback and
   verify runtime health plus the actual user journey before claiming a deployed fix.

### Evidence row for each feature in a whole-product audit

| Feature / catalog entry | Observed problem | Shared/local change | Shell/theme/size journey | Result and limit |
|---|---|---|---|---|
| Exact feature name | Concrete error/screenshot | Owning layer and file | Named interactions and sample dimensions | Fixed / verified unchanged / configuration-blocked / not verified |

A rule exception must identify the rule, concrete reason, affected consumers and proof. If it
conflicts with a task or root policy, name the conflict and ask; do not silently change the rule.
