# mso (product name: **MSO**)

Mobile-first web cockpit for a headless VPS, from any browser. Desktop-style UI
metaphor over a vertical-slice stack; value is utility (terminal/files/monitor/
browser), not an OS. Repo/service/domain keep the `mso` slug; "MSO" is the
UI brand. **Self-contained**: a single Next.js app, no database, no external
agent — it runs AS a host process and controls its own machine.

- Stack: Next 16 (App Router) · React 19 · Tailwind 4 · shadcn/ui · TypeScript.
  **No `middleware.ts` — `proxy.ts`** (Next 16 rename).
- Auth: password + device approval → HMAC signed-cookie session plus live
  Viewer/Operator/Owner role (`lib/auth/`). No Convex, no Clerk; roles are device-scoped
  over one Unix service account, not named-user SSO.
- Host access: `lib/host/` does fs/exec/sys directly (Node `fs` + `child_process`),
  bounded by `OS_FS_READ_ROOTS` / `OS_FS_WRITE_ROOTS`.
- Layout: `app/` + `frontend/slices/<slug>/`; barrel-only cross-slice imports
  (`@/features/<slug>`).

## Read first
- `docs/PROGRESS.md` — source of truth for historical **WHY**, newest entry first.
  Current code and the current-reference documents classified by `docs/README.md` define what
  exists now; dated audits/plans may intentionally preserve obsolete details.
- `README.md` — what it is, features, security model, quickstart.
- `.env.example` — every var you can actually set. Reconciled against `process.env`
  in code on 2026-08-03 (Camoufox, memory/threads paths, `NEXT_DEPLOYMENT_ID`,
  `NEXT_PUBLIC_COMMIT_SHA` were all missing and were added). What is still deliberately
  absent is what you never set by hand: framework vars (`NEXT_RUNTIME`,
  `NEXT_PUBLIC_BUILD_ID` — injected by `next.config`), systemd's (`NOTIFY_SOCKET`,
  `WATCHDOG_USEC`), the OS's (`PATH`, `SHELL`), test-only ones (`E2E_BASE_URL`,
  `OPENCLAW_HOME`), and `OS_BROWSER_*`, which belong to the retired `os-browser/`
  sidecar and not to this app. Still grep `process.env` before adding a new one.
- **The code wins over any doc.** `docs/README.md` classifies the doc set. Current
  reference docs (including `docs/ARCHITECTURE.md`) must track `main`; dated audits/plans
  are explicitly historical and may preserve obsolete implementation details only inside
  that historical context.
- `frontend/slices/assistant/CONTRACT.md` — current, and authoritative for what an
  Agent / Tool / Skill / Playbook is and what reaches the model.
- `docs/MCP-FEATURE-IMPLEMENTATION.md` — stepwise observe/map/bound/reverse-engineer/
  verify playbook for MCP tools, trusted skills and project capabilities.

**The doc set, and the one rule.** `docs/README.md` is the map. `docs/PROGRESS.md` is
the SSOT for historical WHY; current reference docs describe today's contracts; dated
plans/audits are historical. Append to PROGRESS when you ship — do not start a second
HAND-WRITTEN log. (`docs/CHANGELOG.md` was exactly that once and was merged
back in; the root `progress.md` is gitignored local scratch and claims authority it
does not have.) `docs/CHANGELOG.md` exists again as of 2026-08-11 but is **generated
from git subjects** by `scripts/gen-changelog.mjs` and gated stale-by-`gates.sh`, so
there is nothing to keep in sync and no way for it to disagree with history. PROGRESS
is the WHY; CHANGELOG is the WHAT, and it is what Settings → About renders as
"What's new" so a shipped change is visible in the running app.


**Comparison is generated policy, not hand-written marketing.** Edit only
`docs/comparison-data.json`, then run `node scripts/gen-comparison.mjs`. The generator owns the
README block and `docs/COMPARISON.md`, requires an existing repo evidence path for each MSO cell,
restricts competitor sources to reviewed official hosts, requires the SEO-readable words `Strong`,
`Partial`, and `Not offered` rather than icon-only status legends, and expires review after 90 days.
Do not raise a rating because a feature is planned; implementation evidence must land first.

**Service Center never becomes a shell-shaped button collection.** Inventory is Viewer, bounded
journal is Operator, and lifecycle is Operator plus an exact `OS_SERVICE_CONTROL_UNITS` match. Unit
names/actions are fixed argv and wildcards are rejected. Package visibility is cache-only and has no
apply action. New network/storage/user/firewall modules need their own typed policy and tests.

**New workflow skills use `bun run skill:new`, then `bun run skill:check`.** The source template is `templates/mso-skill-flow/SKILL.md.template`; do not hand-copy an untrusted skill into the official root.

**Systematic implementation is the default.** Resolve the canonical source and running target;
reproduce before editing; map the end-to-end pattern and every relevant limit; compare a working
analogue; run one discriminating experiment at a time; make the smallest reversible change; then
verify targeted contract, build, runtime and browser/client state. Do not repeatedly retry the same
failed operation, edit temporary/generated copies, or claim completion from a zero exit code. For
MCP features use `docs/MCP-FEATURE-IMPLEMENTATION.md` and the
`mso-mcp-feature-engineering` skill; tool name/schema/scope/audit/parity/toolset/client refresh and
skill trust/routing are one release contract.

**Shipping is `bun run ship "<conventional commit>"`, not `git push`.** Prod is
systemd with NO webhook, so a pushed commit changes nothing the owner can see until
someone rebuilds. The script does changelog → commit+push (gates run) → build →
restart → and then verifies the served CSS chunk actually resolves. When invoked
through MSO/MCP, it automatically hands build/restart/verification to the owner
`mso-self-update.service` transient user unit after the gated push: replacing
`mso.service` kills every process in its cgroup, including `nohup` children and the
MCP call itself. Poll `systemctl --user is-active mso-self-update.service` and
`~/.mso/self-update.log`; do not treat the handoff call returning as deployment
completion. An SSH invocation remains synchronous. Order is load-bearing: the
changelog is derived, so regenerating it AFTER the commit leaves it one commit behind
forever; and build-then-restart, never the reverse.
Deleted 2026-07-28 as dead: `SHELL-INTEGRATION-PLAN.md` and `SYNC-PLAN.md` (both target
sibling repos that do not exist on this machine), `browser-agent-plan.md` (the retired
Playwright sidecar), `SIXFIX-PLAN.md` (a finished dated fix list). Nothing linked to any
of them. Deleted 2026-07-30 in the same spirit: `PLAN.md` (the "master plan" — every
section contradicted by shipped code, and its one unique asset, a legacy-dashboard-vs-MSO
table, is descriptive rather than decision-carrying) and `MULTISHELL-PLAN.md` (its sibling
repo is gone, all six phases are checked off, and PROGRESS.md:574 reverses its one unique
decision). Both recoverable with `git show bccd0b1:docs/<name>`. Deleted 2026-08-10
(`git show 421ab7f:docs/<name>`): `IOS-PARITY-REFACTOR-PLAN.md` (every phase ✅, and the
`mock-os/` tree it refactored toward no longer exists), `DESIGN-RECONCILE.md` (self-labelled
ARCHIVE, same missing tree), `MOBILE-RESPONSIVE-PLAN.md` (phases 1–4 shipped; phase 5 is the
Playwright verification chore already described below), `SHELL-LAYOUT-KIT.md` (documented
`AppHeader`/`AppInspector`, both deleted the same day), and `AUDIT-2026-06-14.md` +
`SCORECARD-2026-06-14.md` (every row shipped or gone stale — one cites an `/api/v1/browser`
route that does not exist and a coverage install that already happened). **`AUDIT-2026-06-11.md`
STAYS** — five source comments cite its findings by number. `SHELL-FIDELITY-PLAN.md` and
`DRAWER-MENU-BYOK-PLAN.md` also stay: both look finished and are not, each carrying an
unstarted tail (phases D–F, and providers D2–D4). PROGRESS.md's pre-2026-06-15 tail (34
entries) was trimmed the same day; it is one `git show` away.

## Architecture
```
browser ──https──> mso (Next.js :4005) ──── lib/host → Node fs/child_process (host)
              signed-cookie auth (lib/auth)
```
The Browser app is **Camoufox** — a real anti-fingerprinting Firefox on a headless
X display on this host, streamed over noVNC from the reserved split-origin host
`camoufox.<managed-app-domain>`. `proxy.ts` requires a live Operator/Owner device role,
strips cockpit credentials before loopback noVNC, and permanently 404s the retired
same-origin `/camoufox-vnc/*` path. It replaced BOTH the old Playwright sidecar
(`os-browser`, :4002, retired) and the sandboxed-iframe browser that briefly followed it—an
iframe cannot render most of the web because X-Frame-Options refuses framing on many sites.
`os-browser/` stays in-repo only as dev tooling (scripts/e2e use its Playwright
install). See the Browser/camoufox note further down for the systemd user unit.
- `/api/v1/*` = the host API (fs/exec/sys/term/apps/camoufox/managed-apps), every
  route resolves the live device role first. Only explicitly listed reads are Viewer; every unclassified route
  fails up to Owner. Operator exceptions must be explicit and bounded. There is no `/api/v1/browser`.
  Client picks mock (default) vs live in Settings → Server.
- `/api/auth/*` = login/logout/me/devices. `/api/config` = BYOK AI key.
- Persistence is local: window layout + app registry in localStorage; device
  allowlist + config in `~/.mso/*.json`.

## AppShell framework (the shell is generic + rr-liftable)
The shell is NOT one slice. It is split so the whole desktop+mobile shell can lift
to `resources/` (rr) and drive any project from one manifest:
- `frontend/slices/appshell/` — the **generic, brand-free** framework: window runtime
  + desktop/mobile surfaces, app/feature/brand registries, `<Slot region>`,
  `ResponsiveProvider`/`useResponsive` + the 4 DRY primitives, the pub/sub buses
  (toast/activity/inspector), and `<AppShell manifest>` (the one entry point). It
  imports NO brand/feature and NO mso `@/lib/*` — only the universal `@/lib/utils`
  (`cn`). Everything project-specific arrives via `manifest.capabilities`.
- `appshell/features/` currently contains 10 directories: `clipboard`,
  `control-center`, `desktop-icons`, `force-quit`, `inspector`, `lock-screen`,
  `notifications`, `search`, `shortcut-help`, `widgets`. `desktop-icons` and
  `force-quit` are shell infrastructure rather than normal slot features. Keep
  `docs/SLICE-CATALOG.md` and the machine-checked count in sync with the directory tree.
  (`shell-settings` stays a flat UI-primitives slice — not an AppShell feature directory.)
- `os-shell` — the thin mso **consumer**: `shell.manifest.ts` (MSO brand + app
  list + slugs + features) + `capabilities.ts` (adapts `@/lib/appearance`+`os-api`+
  `ai/stream` to `ShellCapabilities`) + a re-export barrel (`@/features/os-shell`
  re-exports appshell verbatim, so all app slices stay unedited).
- **Windowing** (`appshell/lib/store.ts`): `openWindow(app,title,size,payload,{multi})`.
  Default = single instance per app (reuse/focus); `AppDescriptor.multi` (e.g. Files)
  spawns a fresh window each open. `focusApp(id)` reveals the front-most existing
  window without spawning — used by `UrlSync` so deep-links/back-forward don't
  duplicate a multi app. **Window coords (`win.x/y`) are relative to the desktop
  `<section top-[30px]>`, NOT the viewport** — snap/maximize geometry must use
  `workArea()` (section-relative: `top=GAP`, `bottom=vh-TOPBAR-DOCK_RESERVE`), the
  drag snap preview must be `position:absolute` (shares the surface), and drag
  commits must use `offsetLeft/offsetTop`, never viewport `getBoundingClientRect`.
- **`window-content.tsx` loads app bundles with `useState`/`useEffect`, NOT
  `React.lazy`+`Suspense`.** Window opens come from the synchronous external store
  (`useSyncExternalStore`); a Suspense boundary suspending in that path misses its
  retry ping — the chunk resolves but the spinner only clears on the next render
  (a click). A `setState` on import-resolve always re-renders. Don't reintroduce
  Suspense here. Dock hover warms the chunk (`app.load()`), so it stays instant.
- **Dock = macOS behaviour**: clicking a running app focuses its front window
  (`focusApp`, never spawns); hovering shows its open windows to switch + a "New
  Window" entry for `multi` apps. Opening surfaces (Launchpad/Spotlight) spawn.
- **`ShellCapabilities`** is the injection seam: `useAppearance`, `useCpuPercent`,
  `useSearch`→`SearchHit[]`, `useSystemStats`, `useChat`, `useServerToggle`. Defaults
  merged in `CapabilitiesProvider` so optional caps degrade (accessors stay
  unconditional). Add an app = manifest edit; add a shell feature = new
  `appshell/features/<feat>/` + `defineFeature` + add to `DEFAULT_FEATURES`. No surface
  edits (open/closed).

## Routing — the OS is addressable (keep windowing!)
- ONE catch-all route `app/[[...slug]]/page.tsx` (no per-app pages). Windowing is
  untouched; only the **focused** app + its launch path is mirrored to the URL
  (`/files/home/rahman`, `/code`). `appshell` `UrlSync` does it.
- **URL writes use the History API, NOT `router.push`.** Opening a window is pure
  client state — `router.push` triggers a full RSC transition + remount (slow, flashy
  + breaks the sync). Use `window.history.push/replaceState`; Next 16 syncs
  `usePathname`. Deep links / ⌘-middle-click `<Link>` / back-forward still navigate.
- App URL slugs are assigned centrally in `shell.manifest.ts` (`AppDescriptor.slug`,
  falls back to `id`); app slices stay URL-agnostic. Dock + Launchpad use `<Link href>`
  with **`prefetch={false}`** — MANDATORY: left-click is intercepted (never navigates),
  so default prefetch would fire one RSC render of the dynamic catch-all per link
  (24 on load) and peg the VPS. The href is only for middle/⌘-click. Never drop it.
- The catch-all **must `notFound()` reserved paths** (`slug[0]==="_next"`): otherwise a
  missing `/_next/static/*` chunk falls through and returns the app HTML with 200 →
  wrong-MIME refusal, no recovery. 404 lets the client router hard-reload onto the new build.
- `next/Image` ONLY where the optimizer helps (browser favicons via the fixed Google s2
  host in `next.config` `images.remotePatterns`). Host-fs images + the live Playwright
  screenshot stream stay raw `<img>` on purpose (dynamic/auth'd bytes).

## Deploy / ops (prod :4005 + demo :4006 are systemd, not Dokploy)
- `mso.service` (:4005, WorkingDir `/home/rahman/projects/mso`) serves
  mso.rahmanef.com via `next start`.
- `mso-demo.service` (:4006, WorkingDir `/home/rahman/.mso/worktrees/mso-demo-runtime`,
  `NEXT_PUBLIC_OS_DEMO=1` → no auth, mock data). It had been deleted at some point and
  was **re-created 2026-08-03** to make UI/UX verification possible without logging in.
  It binds **127.0.0.1 only, deliberately**: demo mode disables login, so a `0.0.0.0`
  bind would publish an unauthenticated shell. It is mock-data-only so the blast radius
  is small, but exposing it is the owner's decision — put it behind the reverse proxy
  explicitly if you want it public. The checkout is a shallow clone of this repo with
  `node_modules` copied in; rebuild it with the flag (`NEXT_PUBLIC_OS_DEMO=1` is inlined
  at BUILD time) whenever you re-deploy it.
- **Deploy prod:** use `bun run ship "<conventional commit>"`. It regenerates the
  derived changelog, runs the committed pre-push gates/out-of-tree build, pushes the exact
  SHA, then finalizes the in-place build/service replacement/chunk verification. Through
  MSO/MCP, finalization runs in `mso-self-update.service`; completion is proven only when
  the log ends `UPDATE OK`. Operator update/recovery is Settings → About or
  `mso update run [--rebuild]`. Do not use a bare in-place build merely to verify code.
- **Service worker** is served from `app/api/sw/route.ts` with a **`beforeFiles`
  rewrite `/sw.js`→`/api/sw`** (in `next.config`): a literal `app/sw.js/route.ts`
  gets shadowed by the optional catch-all, and routes under `/api` are never caught.
  The SW bakes `BUILD_ID` into its cache name so its bytes change every deploy →
  the browser detects a new SW → the "Versi baru" reload toast fires (a static
  `public/sw.js` is byte-identical across deploys, so the toast never fired). It
  caches ONLY icons+manifest, never chunks/HTML.
- **New routes need a clean build.** Adding a new `app/**/route.ts` or page folder
  may not register under incremental Turbopack. On the live production checkout use
  `mso deploy`; for verification use `mso build`. Never remove/replace live `.next`.
- **`git add` aborts on a bad pathspec** and stages NOTHING new — after a
  `git rm`, don't re-list the removed file in `git add`; prefer `git add -A` and
  check `git status --short` before committing (a broken commit shipped once this way).
- **Deploy demo** (it IS running — `active`+`enabled`, 200 on 127.0.0.1:4006): from
  `/home/rahman/.mso/worktrees/mso-demo-runtime`: `git fetch origin -q && git reset --hard
  origin/main -q && bun run build && sudo systemctl restart mso-demo.service`.
  Mind the cwd — running the sync from the prod dir is a classic slip.
- **`bun run build` is now fail-closed on a live checkout.** The package script
  acquires the checkout runtime-exclusion lock and refuses before touching `.next`
  when a Next/MSO runtime is serving that same checkout. Use `mso build` for the
  out-of-tree compile proof and `mso deploy` for a production rebuild. The reason is
  fundamental: Next loads manifests at process start while `next build` replaces
  `.next`; mixing those generations makes already-served HTML point at missing chunks.
  Raw `next build` is an internal deploy primitive only after the supported lifecycle
  has quiesced the runtime.
- **The Browser app powers a systemd USER unit**, `camoufox-vnc.service` in
  `~/.config/systemd/user/`, whose `ExecStart` points at **`scripts/camoufox-vnc-service`
  in THIS repo** (it used to live untracked under `~/.openclaw/workspace/`, so a fresh
  clone could not start the Browser at all and the `-nopw` → `-rfbauth` hardening had no
  version control). The script refuses to start without a VNC password file. Two further
  host-side facts that the installer flow (`scripts/install.sh` → verified `scripts/install-core.sh`) NOW CARRIES, and that the feature dies
  quietly without: (1) `loginctl enable-linger <user>`, or the unit stops at
  logout and never starts at boot; (2) `Environment=XDG_RUNTIME_DIR=/run/user/<uid>` in
  mso.service — a system unit running as `User=` gets NO user-bus address, so without it
  every `systemctl --user` call fails with "Failed to connect to bus: No medium found".
  `lib/camoufox/service.ts` reports that as an error rather than as "not installed", so the
  panel tells you which one it is.
  Treating these as un-carryable host lore was itself the bug: a host set up by
  the installer flow had neither, so the Browser app looked uninstalled and every
  managed-app install died at the step that registers its user service. The installer sets
  both now, and `lib/managed-apps/user-bus.ts` re-derives the bus address at call time so a
  cockpit installed BEFORE this change is not left broken until someone re-runs the
  installer. An existing host still needs the linger (`sudo loginctl enable-linger <user>`);
  re-running `scripts/install.sh` applies the rest.
  (3) The unit is deliberately left **`disabled`** with `Restart=no` + `RuntimeMaxSec=2h`:
  the UI toggle is plain `start`/`stop` and must NEVER go back to `enable --now`, or every
  click re-arms boot autostart — that is how it once ran 26 h with zero viewers. Ship
  `Restart=no` and the lease together; a lease under `Restart=always` is a 2-hourly reboot
  loop. (4) `CAMOUFOX_PROFILE` points at `~/.local/share/camoufox/profiles/linkedin`, NOT
  `~/.cache` — it holds the live logins, and a wrong path makes `mkdir -p` create an empty
  profile with no error. This unit has no copy or installer in the repo, so (1)–(4) exist
  nowhere else. (5) That profile holds a **live Google session** (`SID`,
  `__Secure-1PSID`, `SAPISID`) as well as LinkedIn's `li_at` — cookie theft there is
  account takeover with no password and no 2FA prompt. So: the profile dir is `chmod 700`
  on every start (Firefox writes `cookies.sqlite` 0644 by default), the VNC password goes
  in the viewer URL's **fragment** and never its query string, and every start snapshots
  `cookies.sqlite*` + `key4.db` + `cert9.db` into `~/.local/state/camoufox/session-backup/`
  (3 generations, 0700). Restore after an accidental wipe: stop the unit,
  `cp -p ~/.local/state/camoufox/session-backup/1/* <profile>/`, start. Roll back to `2`
  or `3` if generation `1` already captured the logged-out state.
- **Two committed browser checks**: `bun run e2e` (shell) and `bun run e2e:preview
  [width]` (Preview app + Settings → About update panel). Both install the session
  cookie rather than drive the login form, and both take a viewport — run them at
  1280 AND 390. `e2e:preview` provisions its own fixtures under
  `~/.cache/mso-e2e-preview` and asserts bytes ARRIVED (`naturalWidth`, `readyState`,
  text inside the sandboxed frame), not that elements exist.
- Verify shell behaviour with **Playwright directly** — `os-browser/node_modules/playwright`
  (CommonJS) is the repo's only install — at 1280 for desktop and 390 for mobile. The
  `os-browser` SERVICE is gone (its source was deleted 2026-08-10; only the vendored
  Playwright install remains). Point Playwright at the **demo on 127.0.0.1:4006** — it
  runs, and demo mode skips login entirely — or at :4005 and log in. Drive Spotlight with Meta+k; click the dock by
  the BOTTOM-most `a[href="/<slug>"]` (the centre ones are the hidden Launchpad).
  `X-Content-Type-Options: nosniff` is set on all routes, so wrong MIME is fatal — keep
  static Content-Types correct.

## Rules in force
- **One canonical checkout; parallel work only through isolated hidden worktrees.**
  `/home/rahman/projects/mso` on `main` is the only canonical checkout and release SSOT.
  Never create task-specific `mso-*` siblings under `~/projects` and never let two
  sessions share one worktree, `HEAD`, or index. If parallel work is necessary, use one
  Git worktree per task under `~/.cache/mso-worktrees/mso-<task>`. Never put a development
  checkout under `~/.mso`: host-file security deliberately treats that entire tree as private state. The older one-checkout rule
  existed because shared-index sessions repeatedly wiped/bundled each other's work;
  isolated worktrees solve that collision without creating another source of truth.
  A worktree is development-only: preserve its tracked/untracked WIP, reconcile every
  user-deliverable commit into `main`, verify there, and ship through `bun run ship`.
  Do not call a feature shipped while it exists only in a worktree/feature branch; the
  installer and updater intentionally deliver only `origin/main`. Never prune a dirty
  worktree until its intended work is committed/archived and accounted for.
- Max 200 lines/file, single responsibility, shadcn primitives only, theme tokens
  not hex, mobile-first. Barrel-only cross-slice imports.
- `/api/v1` host ops go through `lib/host` (bounds + realpath checks) — never call
  `fs`/`child_process` straight from a route.
- Solo-dev: push direct to `main` once `bun run verify` is green (typecheck + lint +
  test + check + audit). Conventional commits + Claude co-author.
- **The gates live in `scripts/gates.sh`, which IS committed.** `.git/hooks/pre-push`
  is a one-line shim that execs it; reinstall with `bash scripts/gates.sh --install`.
  They used to live in the untracked hook itself, which meant a fresh clone had NO
  gates and an sc-git hook reinstall silently dropped the audit + build guards while
  re-adding a `check-slices.mjs` line for a script deleted on 2026-08-03. Four guards
  run, ~70 s per push: sc-git `ci.js --skip build` (Guard 1, falling back to `bun run
  verify` when that shared runner is not on the machine — a fresh clone must not skip
  it silently), `check-cycles.mjs` (1b), `scripts/audit.mjs` (1c),
  `scripts/verify-build.sh` (1d). Guard 2 is a self-hosted-Convex auto-deploy that is
  a silent no-op here. A healthy push prints `audit: clean at high/critical.` and
  `build: HEAD compiles (out-of-tree).` — **if those two lines are missing, the wiring
  is gone.** The `--skip build` is deliberate safety, not laziness (see Deploy/ops).
- **`bun run audit` ≠ `bun audit`.** The script is `scripts/audit.mjs`, which wraps
  `bun audit --json` because raw `bun audit` fails CLOSED — offline it exits 1, the
  same code as a real advisory, which would turn every network blip into a fake
  security failure. It skips when the registry is unreachable, applies a high/critical
  floor, and keeps an `IGNORE` map (keyed by GHSA, with a reason and a date) for
  advisories with no upstream fix. `--json` ignores `--audit-level`/`--ignore`, so the
  filtering is done in the script. `ci.yml` runs the raw fail-closed command on
  purpose: a release gate must not pass an audit it could not perform.

## MCP server (`/mcp`) — optional, OFF by default
An MCP endpoint so ChatGPT / Claude.ai / Cursor can drive the host. `lib/mcp/*`
includes OAuth/PKCE/store/scope, read/discovery/learning/power/write tool catalogs,
toolset metadata, workflow activity and dispatch; routes live under `/mcp`, `/oauth/*`
and `/.well-known/oauth-*`. **`OS_MCP_ENABLED=1` or every one of those routes 404s** —
that is the kill switch, and demo mode forces it off. Read `docs/MCP.md`; for ChatGPT
setup/diagrams use `docs/CHATGPT-PLUGIN.md`.
Implementation changes must also follow `docs/MCP-FEATURE-IMPLEMENTATION.md`; inspect
the real runtime and working analogue before changing a tool or skill contract.
- **`/mcp` is deliberately NOT under `/api`.** `proxy.ts` blocks mutating `/api` that
  cannot prove same-origin and an MCP client is cross-origin by definition; the bearer
  is the control, not the CSRF gate. `proxy.ts` exempts `/mcp`, `/oauth/token`,
  `/oauth/register` and `/.well-known/oauth-*` from BOTH that gate and the document
  CSP. `/oauth/authorize` is NOT exempt — it is a real HTML page and needs its nonce.
- **Tool execution is transport-neutral.** `lib/capabilities/*` owns scope, required-argument validation, workflow correlation, rate limits, audit/activity and execution semantics. MCP/A2A/agent surfaces are adapters over that kernel. Host operations flow through narrow `lib/host/*-api.ts` facades, which preserve `OS_FS_*_ROOTS`, the credential denylist (including `~/.mso`) and destructive-command guards. Do not reimplement a guarded host operation inside an adapter.
- Scope ladder `read < write < exec`, picked per token on the consent page, capped by
  `OS_MCP_MAX_SCOPE`. The default ceiling is `exec`, and consent preselects the highest
  permitted tier; set the env to `read` or `write` to opt down. `tools/list` filters by
  it AND `tools/call` re-checks it — a client can call a name it was never shown.
- **Tool names are an MSO public API contract.** Keep global names MSO-owned and generic.
  Project-owned MCP names are data behind `project_mcp_tools` / `project_mcp_call`; never copy them into the global catalog.
  The exact full MSO catalog **and** compact ChatGPT profile are source-generated in [`docs/generated/MCP-CATALOG.md`](./docs/generated/MCP-CATALOG.md); `GET /mcp` remains the live version/hash authority. Hidden ChatGPT-profile names are rejected at call time, not merely omitted from `tools/list`.
- Store is `~/.mso/mcp.json`, **sha256 only**, same atomic-write + fail-loud-on-corrupt
  rule as `lib/auth/device-store.ts`. Codes are single-use, 60 s, deleted BEFORE the
  token is minted. `browser_status` must never return the VNC password — that profile
  holds a live Google session.
- **The capability kernel writes the audit trail, because model-facing tools bypass route-layer audit.** `/api/v1` routes audit at the route layer; capability tools may call guarded host APIs directly, so `lib/capabilities/execute.ts` enforces scope/rate/workflow telemetry and records declared `CapabilityTool.audit` actions once for MCP/A2A/agent adapters. MCP uses `actor: mcp:<id>` and `meta.via = "mcp"`; scope refusals log `mcp.denied`. Reads stay unlogged, same rule the routes follow. `GET /api/v1/sys/audit`
  reads it (session-gated); there is deliberately **no MCP tool** for it, or a
  compromised token could check whether it had been noticed.

## Install/update requests from an AI agent
When a user points an agent at this repository and asks to install or update MSO, the agent must use
`scripts/install.sh` / `mso update`, not hand-roll a competing setup. The installer is also the backward-
compatible bridge for old installations that predate `mso update` and Settings → About: it detects the
active service checkout, preserves `.env.local` + `~/.mso`, and updates in place. Never create a second
install beside an owned service or reset dirty/diverged source. End with `mso doctor` and health proof.
Credential prompts remain hidden/STDIN; tell the user where to create/store a required key, never put it
on argv or in an agent transcript.

## CLI (`bin/mso`) — the web UI is only one frontend
`bin/mso` reaches the same `/api` surface from a shell — every route has a named verb
(enforced by a test in `bin/mso.test.ts`), plus `doctor`, `completion` and `--base`.
`scripts/install.sh` verifies and launches `scripts/install-core.sh`; the core symlinks
it to `~/.local/bin/mso` and symlinks `claude-skills/*` into `~/.claude/skills/`
(every committed directory under `claude-skills/`, including `/mso-skill-authoring`).
`mso -h` lists every verb; `mso api <METHOD> <path> [json]` is
the escape hatch for anything without a named verb.
- **Every CLI caller must send `Origin: <base>`.** `proxy.ts` blocks mutating `/api`
  that cannot prove same-origin; a browser proves it with `Sec-Fetch-Site`, and the
  documented fallback is an `Origin` whose host matches `Host`. Without it login
  itself 403s `cross_origin_blocked` — before any device check, so the error looks
  like an approval problem and is not.
- One shared CLI device id lives in `~/.mso/cli.device.id` (auto-created, approve
  once with `mso approve $(cat ~/.mso/cli.device.id)`). `audit.js` and
  `image-editor.sh` read the same file — do not reintroduce per-script hardcoded ids.
- Local verbs (`-h`, `approve`, `devices`, `device role`, `service`, `build`) can use the
  private device store/systemd directly where documented, so recovery still works while the service is down.

## Local dev
```bash
bun install
cp .env.example .env.local   # set OS_LOGIN_PASSWORD + OS_SESSION_SECRET
bun run typecheck
bun run dev                     # OS desktop at :3000 (mock data by default)
node scripts/approve-device.js <deviceId> "my device" --role owner   # bootstrap login
```

## Package manager: bun installs, Node runs (migrated from pnpm 2026-08-03)
`bun.lock` is committed; `pnpm-lock.yaml` is gone. **The runtime did NOT migrate** —
`.nvmrc`/`engines.node` still pin Node 22 and prod's `ExecStart` is still
`/usr/bin/npm run start`. `next`/`tsc`/`eslint`/`vitest` carry `#!/usr/bin/env node`
shebangs, which `bun run` honours, so every tool still executes under Node.
- **`bun run test`, NEVER `bun test`.** The builtin runner shadows the script, ignores
  `vitest.config.mts`, and exits 0 having run nothing — `verify` goes green testing zero
  files. Same trap in `.github/workflows/ci.yml`.
- **`node-pty` must stay in `trustedDependencies`.** No Linux prebuild → it compiles at
  install; bun skips lifecycle scripts for untrusted packages. It loads eagerly through
  `lib/host/pty.ts` → `lib/host/index.ts`, which every `/api/v1` route imports, so a
  skipped build breaks the whole host API, not just Terminal. After ANY dependency
  change: `node -e "require('node-pty')"` before building.
- **Never `bunx`/`bun x` in a deploy or CI script** — unlike `pnpm exec` it downloads a
  missing package and runs it. Call `node_modules/.bin/<tool>` directly.
- `unrs-resolver`/`protobufjs` postinstalls stay blocked (both work from prebuilt
  binaries). Don't "fix" the `bun pm untrusted` warning. `sharp` used to be a third
  entry here; 0.35 dropped its install script, so it no longer appears at all.
- `lib/host/cleanup.ts`'s pnpm-store card stays — other repos on this box still use it.
