# OS Settings: update automation, Devices merge, account icon — plan

Status: **open plan, 2026-10-21. Nothing here is shipped.** Each phase lands as its own
PR and its own gate run. This document is the decision record, not the implementation.

Scope is five owner-facing gaps reported from the live deployment:

1. Auto-update opt-in (checkbox).
2. "Stable only" update channel (no rolling `main`).
3. Devices out of Account, merged with Server into one top-level **Devices** section.
4. Account icon picker (emoji / Lucide / Phosphor) from
   `https://resource.manef.dev/slices/icon-picker`.
5. Uploaded art is converted server-side to WebP + ICO + favicon sizes, with a hard
   input cap, so a 4 MB phone photo never becomes a 4 MB icon.

Prerequisite already done: the missing Update button was **not** a UI bug. The checkout
was on `feat/linear-provider-composio-key-routing`, so
`updateBranchReason()` reported `supported:false` and `update-section.tsx` correctly
rendered zero buttons. Fixed by moving the checkout to `main` and running
`mso update --rebuild`. See "Phase 0" for the durable fix so it cannot recur silently.

---

## Phase 0 — make the "cannot update" state self-explanatory (small, ship first)

Right now a non-`main` checkout produces a page with no action and no explanation. The
reason string exists in `UpdateStatus.reason` but only reaches the section footnote.

Files:

- `frontend/slices/os-settings/components/update-section.tsx` — when
  `info.supported === false`, render `UpdateStatusUnavailable` with the actual
  `info.reason` plus the one-line remedy (`git checkout main`, then rebuild), instead of
  falling through to a footnote. No buttons, but not a dead end either.
- `frontend/slices/os-settings/components/update-status-card.test.ts` (new) — assert the
  unsupported card surfaces the reason text.

Acceptance: opening Settings → About → Updates on the feature branch shows
"software updates require the checkout to be on main (current: …)" and the remedy.

---

## Phase 1 — Devices section: merge Server into it, move it out of Account

Owner decision: **Account should hold identity only** (name, icon, password, sign-out).
Devices and Server belong together because both answer "what machine am I talking to and
who may talk to it".

### Navigation model

| Before | After |
| --- | --- |
| Account → Devices (nested) | **Devices** (top level, group `system`) |
| Server (top level) | folded into **Devices**, no separate section |
| Account → About (nested) | unchanged (nested, stays) |

`frontend/slices/os-settings/lib/sections.ts`:

- `SectionId`: drop `"server"`, keep `"devices"`.
- `CATALOG.devices`: `label: "Devices"`, `blurb: "This server, approved browsers, and auto-lock"`,
  icon `ShieldCheck` (keep) — or `Server` if the merged body leads with the host target.
- `CATALOG.server`: delete.
- `NAV_ORDER`: replace `"server"` with `"devices"` (same position, group `system`).
- `SEARCH_EXTRA`: `devices` gains `"server ssh live mock target host vps approved browser sessions auto-lock"`.
- `settingsNavActive`: keep `account` covering `about` only; drop the `devices` clause.
- `settingsBackTarget`: `about → account`; `devices` returns `null` (it is now top level).

### Body

`frontend/slices/os-settings/components/sections.tsx`, case `"devices"`:

1. Host target card — moved verbatim from `server-section.tsx` (`ServerSection`,
   `addSshTarget`, `selectServerTarget`, `updateServerTarget`, test/connect row).
2. Auto-Lock card — unchanged (`AutoLockRow`).
3. Approved devices card — unchanged (`DevicesPanel`).
4. Delete case `"server"`.

`server-section.tsx` shrinks to the exported pieces the merged body imports, or is
renamed to `devices-host-card.tsx`. Prefer the rename: one section, one file name that
matches the nav.

### Account

`account-section.tsx`: remove the "Also in Account → Devices" row and the footnote that
promises it. Keep About. Blurb becomes `"Name, icon, password, and about"`.

### Redirects

Old deep links must not 404: `?section=server` → `sectionFromSearch` maps to `"devices"`;
`?section=devices` keeps working. Add both to the mapping test.

Tests to update: `frontend/slices/os-settings/lib/sections.test.ts` (nav groups, last
section still `updates`, `settingsBackTarget("devices") === null`, `server` alias),
`about-pages.test.ts` untouched, plus any e2e selector that clicks `Server`.

Acceptance: Settings nav lists `Devices` once, no `Server`; the merged page reaches the
live host, approves/revokes a device, and toggles auto-lock without leaving the section.

---

## Phase 2 — Account icon picker + image pipeline

Two independent halves. Ship the picker first; conversion is a separate PR because it
touches server-side bytes.

### 2a. Icon picker

Owner asked for `https://resource.manef.dev/slices/icon-picker`. That catalog is
installable and self-describing:

```
npx rahman-resources add icon-picker   # alias: npx rr add icon-picker
```

It copies `frontend/slices/icon-picker/` into the project and installs
`@phosphor-icons/react` (new dependency; `lucide-react` already present). Stored value
contract is a plain string:

```
emoji:<char> | lucide:<Name> | phosphor:<Name>   with optional ?c=<hex>
```

Decision: **adopt the slice, do not hand-roll a picker.** It ships search, recents, tint,
keyboard grid nav and popover→dialog fallback, and an `IconPickerPopover` +
`DynamicIcon` pair. Hand-rolling the same surface is ~3× the code for less behaviour.

Model change in `lib/auth/account-profile-model.ts`:

```ts
export type AccountIcon =
  | { type: "preset"; id: AccountPreset }        // existing, kept for old stores
  | { type: "library"; value: string }           // NEW: emoji:/lucide:/phosphor:
  | { type: "image"; src: string };              // existing, now always WebP
```

`lib/auth/account-profile.ts` must validate the new `library` value the way it already
validates presets: allow only `^(emoji:[^\\s]{1,8}|lucide:[A-Za-z0-9]+|phosphor:[A-Za-z0-9]+)(\\?c=[0-9a-fA-F]{6})?$`,
cap length (say 96), and reject anything else. This is a trust boundary — the value is
rendered into an SVG-adjacent component.

UI: `account-profile-card.tsx` replaces the 8 fixed preset buttons with
`IconPickerPopover`, keeping the existing upload button beside it. `account-avatar.tsx`
gains a `library` branch that delegates to `DynamicIcon`, and keeps the preset map for
back-compat.

Bundle note: the slice lazy-loads its ~250 Lucide + ~190 Phosphor catalogs behind
`React.lazy`, so pages that never open the picker pay nothing. Verify with
`bun run bundle:check` — the eager shell budget (currently 884.9 KiB raw / 282.5 KiB
gzip) must not move.

### 2b. Upload → WebP + ICO + favicon, with a hard cap

Owner requirement: accept anything a phone produces, but never store or serve a fat
file. Targets below are the decision.

| Output | Size | Format | Consumer |
| --- | --- | --- | --- |
| `icon.webp` | 256×256 | WebP q82 | in-app avatar, About tile |
| `icon-192.png` / `icon-512.png` | 192, 512 | PNG | PWA manifest (WebP is not universally accepted there) |
| `apple-touch-icon.png` | 180×180 | PNG | `app/apple-icon` |
| `favicon.ico` | 16, 32, 48 multi-entry | ICO (PNG-embedded) | browser tab |

Input rules:

- Accept `image/png|jpeg|webp|gif|avif|heic` **and** SVG (rasterize first).
- Hard cap **8 MiB** on the request body; reject earlier at the multipart/JSON layer.
- Decode with `sharp` (already a transitive dependency via Next; it must become an
  explicit `dependencies` entry — relying on Next's optional dep is not a contract).
- `sharp` **cannot write ICO** (`sharp.format` exposes png/webp/jpeg/avif/tiff/gif only,
  verified on this host). Do **not** add a dependency for it: an ICO is a 6-byte header,
  N×16-byte directory entries, then the PNG payloads. ~30 lines, and PNG-embedded ICO is
  readable by every browser that matters.
- Strip metadata (`withMetadata` off, no EXIF), flatten alpha onto the current
  background colour instead of storing transparency where the target needs a square.
- Reject images whose decoded pixel area exceeds ~40 MP before resizing (decompression
  bomb).

Where it lives:

- `lib/auth/account-icon-image.ts` (new) — pure-ish: `decode → normalise → encode` with
  `sharp`, returns `{ webp, png192, png512, apple180, ico }` as Buffers. One runnable
  check behind it (assert-based or one vitest file) proving: EXIF stripped, output is
  WebP (`RIFF....WEBP` magic), ICO directory offsets are correct, oversize input is
  rejected rather than truncated.
- `app/api/auth/account/icon/route.ts` (new, `runtime = "nodejs"`) — owner-only, same
  session gate as `POST /api/auth/account`, body-size capped, returns the stored profile.
- Store the **WebP** in the existing `account.json` (`imageIcon` already caps at 32 KB —
  a 256×256 q82 WebP of a photo lands well under that; keep the cap as a backstop, raise
  it to 48 KB only if a real photo exceeds it).
- Static icon files become dynamic: `app/icon.svg` is a static file today, so a per-owner
  icon cannot reach the tab. Replace with `app/icon.tsx` + `app/apple-icon.tsx` reading
  the stored profile (with the current brand SVG as fallback), so favicon/apple-touch
  follow the owner's upload. `app/manifest.ts` icons point at the same dynamic routes.
  Cache: short `max-age` + revalidate, because these are read on every page load.

Acceptance: upload a 4 MB phone JPEG → tab favicon, in-app avatar, PWA 192/512 and Apple
touch all show the new art; stored `account.json` grows by < 48 KB; no `sharp` output
retains GPS.

---

## Phase 3 — Auto-update checkbox

Owner wants an opt-in "keep this host updated automatically". Design:

**Scheduler = systemd user timer, not cron.** The installer already enables linger and
gives `mso.service` `XDG_RUNTIME_DIR` so the service can reach the per-user manager; the
updater already launches as a transient `--user` unit. Reusing that path means no new
credential surface, no sudo, and the same log the panel already polls.

- `mso-self-update.timer` (user): `OnCalendar=*-*-* 04:30` + `RandomizedDelaySec=25m`,
  `Persistent=true`. Nightly, jittered, catches up after downtime.
- `mso-self-update.service` (user, already exists as transient) gains a persistent unit
  twin so the timer can trigger it without a build-time argument.

**Gate before firing** (reuse, do not reimplement):

- `getUpdateStatus(true)` → refuse when `!supported`, `dirty`, `running`, `ahead > 0`.
- Refuse when a build already failed twice in a row (read the log's `FAILED:` markers) —
  a broken commit must not be retried forever unattended.
- Never auto-apply when `behind > 0` **and** the incoming commits touch the updater itself
  (`lib/host/self-update.ts`, `scripts/mso-service-update`, `scripts/self-update.sh`) —
  that is the one case where an unattended restart can strand the host.

**State** (single source, `lib/prefs/store.ts` `tweaks.updates`, owner-only POST like the
rest of `/api/prefs`):

```ts
updates?: {
  auto: boolean;              // default false
  channel: "stable" | "main"; // default "stable"
  lastAttemptAt?: number;     // written by the updater, not the client
  lastResult?: "ok" | "failed" | "skipped";
}
```

**CLI parity** (`mso` must reach the same state without a browser):
`mso update --auto on|off`, `mso update --channel stable|main`, `mso update status` prints
the same block. `docs/CLI.md` is generated, so the contract test catches drift.

**UI**: a `SettingsToggleRow` in the Updates card ("Update automatically at night"),
disabled with an explanation when `supported === false` (e.g. feature branch, dirty
checkout). Show `lastAttemptAt` + `lastResult`. Never show "on" when the timer unit is
missing — read the unit's real state, not just the pref.

Acceptance: enabling writes the pref **and** installs+enables the timer; disabling really
removes it. `systemctl --user list-timers` reflects the toggle. A simulated failed build
stops the next run and surfaces "paused after 2 failed builds".

---

## Phase 4 — "Stable only" channel

Today `origin/main` is hard-coded (`lib/host/self-update.ts` comment: "the only knob is a
boolean, and `origin/main` is hard-coded"). Stable needs a second, equally bounded ref.

Decision: **stable = highest semver git tag reachable from `origin/main`**, not a branch.
Tags exist (`v0.2.0`, ancestor of `main`) and `package.json` is at `0.2.23`, so tags have
lagged — Phase 4 starts by deciding whether stable tags are cut per release or the
channel is simply "latest tag, else main". Recommend: keep it honest — if no tag is newer
than the running build, the stable channel reports "already up to date" rather than
silently falling back to rolling `main`.

Implementation sketch:

- `updateBranchReason()` currently hard-requires `main`. Generalise to
  `updateRefReason(branch, channel)`; a stable checkout is still on `main` but the target
  commit is the tag (`git rev-parse <tag>^{commit}`), so the checkout branch rule does not
  need to change.
- `getUpdateStatus` compares `HEAD` against the channel target instead of `origin/main`.
  `behind` = `git rev-list --count HEAD..<target>`; `commits` from `HEAD..<target>`.
- The transient unit needs the ref. Keep the current security property — **no client
  string is ever interpolated into a command** — by passing a fixed enum
  (`--channel=stable|main`) and resolving the tag server-side inside
  `scripts/self-update.sh` with the same allowlist.
- Fast-forward still required: if `HEAD` is not an ancestor of the target tag, refuse
  with "reconcile first" rather than force-checkout.

Acceptance: on `main` with a newer tag, stable channel reports that tag and updates to
it; with no newer tag it reports current even when `main` has moved. Existing
`updateBranchReason` tests keep passing for the `main` channel.

---

## Sequencing and cost

| Phase | PR | Rough size | Risk |
| --- | --- | --- | --- |
| 0 | 1 | ~40 lines + 1 test | none |
| 1 | 1 | nav model + 3 components + tests | medium: touches every Settings entry point |
| 2a | 1 | new dep + model + 2 components | low: lazy-loaded catalog |
| 2b | 1 | new lib + route + dynamic icon routes | medium: server-side bytes, favicon caching |
| 3 | 1 | timer units + pref + CLI + UI | medium: unattended restarts |
| 4 | 1 | updater ref resolution | **high**: this is the code that replaces the running process |

Phase 4 is last on purpose. Phases 0–2 are additive; Phase 3 can strand a host only
through a failed build; Phase 4 can strand it by pointing at the wrong commit.

## Explicit non-goals

- No separate "Server" section kept for muscle memory — the merge is the requirement.
- No client-side image conversion as the source of truth. Canvas can pre-shrink to save
  upload time, but the server re-encodes and is the only thing that decides what is
  stored, because the client is untrusted.
- No ICO npm package.
- No automatic update on the `main` channel by default, and no auto-update at all while
  the checkout is off `main`.
- No per-device icons. The icon is the owner account's identity.

## Known environment issue found while doing this

`umask` on this host is `0002`, so `git worktree add` creates `0775` directories and
`pinSecurityStorePath()` refuses them as group-writable. `bun run verify` therefore fails
3 tests locally while passing in CI (`umask 0022`). Workaround used for this PR: run the
gate under `umask 022`. Proper fix (separate PR): `fs.chmod(workspacePath, 0o755)` right
after `prepareProjectWorktree()` or a test-level `umask` set, so a local gate run is
trustworthy.
