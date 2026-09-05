# Development

## Setup

```bash
git clone git@github.com:rahmanef63/mso.git && cd mso
curl -fsSL https://bun.sh/install | bash   # if bun is missing (see "Package manager" below)
bun install
cp .env.example .env.local   # set OS_LOGIN_PASSWORD + OS_SESSION_SECRET (openssl rand -hex 32)
bun run dev                     # http://localhost:3000
node scripts/approve-device.js <deviceId> "my laptop" --role owner   # deviceId shows on login
```

## Layout

Every feature is a self-contained **vertical slice** under `frontend/slices/<slug>/`
(its own components, hooks, and a `lib/host.ts` seam for host I/O). One manifest,
`frontend/slices/os-shell/shell.manifest.ts`, wires slices into the shell — so
**adding an app = one slice + one manifest entry**. Host access is bounded in
`lib/host` (Node `fs`/`child_process`, filesystem-jailed) behind signed-cookie plus live device-role auth
(`lib/auth`). See [ARCHITECTURE.md](./ARCHITECTURE.md).

## Quality gates

TypeScript enforces `noUnusedLocals` and `noUnusedParameters`. Remove genuinely unused imports/declarations; keep required side effects and use an explicit `_` prefix only for positional interface/callback arguments.

```bash
bun run verify              # full repository quality gate
bun run test:features        # one process per area; exit 2 means skipped/incomplete evidence
bun run audit:strict         # fail closed on missing/malformed dependency evidence
bun run security:ultimate   # release assurance: independent scanners + component security review + DAST
```

The **committed source of truth** for pre-push policy is `scripts/gates.sh`. The
actual `.git/hooks/pre-push` file is an intentionally tiny untracked shim; reinstall it
idempotently with `bash scripts/gates.sh --install`.

The gate runs the repository-owned `bun run verify`, cycle checks, generated-changelog freshness, documentation/skill checks,
comparison evidence/freshness, the strict high/critical dependency audit, and an out-of-tree production
build.
`check-contrast.mjs` is informational. None of the build verification touches the live
checkout's `.next`. A healthy push ends with `audit: clean at high/critical.` and
`build: HEAD compiles (out-of-tree).`

The local dependency audit may explicitly skip an unavailable registry; that is not a security pass.
`bun run audit:strict`, the pre-push gate, and the assurance runner reject incomplete evidence. `test:features` distinguishes
PASS, PARTIAL, SKIPPED and FAIL. Per-area exact-include configurations and result-set validation prevent substring-filter double counting; a root inventory contract prevents unregistered root tests. Slices without colocated unit tests are listed as coverage gaps,
not invented successes. Browser rendering and live third-party operations need separate acceptance.
The gate has no sibling-repository runner or dormant Convex deployment step. Worktree hook installation
uses Git's shared hook path rather than assuming `.git` is a directory.


## Comparison governance

`docs/comparison-data.json` is the only hand-edited comparison source. It records criterion
definitions, per-product notes, official source URLs, and repository evidence for every MSO rating.
Do not hand-edit the generated README comparison reference or `docs/COMPARISON.md`. After an implementation or
source review:

```bash
node scripts/gen-comparison.mjs
node scripts/gen-comparison.mjs --check
```

The checker validates MSO evidence paths, restricts competitor links to reviewed official hosts,
requires the SEO-readable status words `Strong`, `Partial`, and `Not offered`, and expires the
comparison after 90 days. A rating may improve only after its repository evidence exists.
Specialist boundaries and the prioritized execution sequence live in
`docs/COMPETITIVE-ROADMAP.md`.

## Dependency update policy

Dependabot keeps production, development, and GitHub Actions updates visible, but a green security
scan is not enough to merge a dependency change: the repository `Verify` job must pass too. Minor
and patch updates are grouped to reduce PR noise. Major toolchain updates are evaluated separately
because they can require source or configuration migrations.

`eslint` 10 and TypeScript 7 are temporarily ignored in `.github/dependabot.yml`: the current
Next.js ESLint plugin stack fails under ESLint 10, and the current `typescript-eslint` stack rejects
TypeScript 7. Remove an ignore only after the isolated candidate passes typecheck, lint, repository
checks, and the out-of-tree production build. This is a compatibility hold, not a permanent version
pin and not an exemption from Dependabot security updates.

## Deploy — and the build hazard ⚠️

mso deploys via **systemd on the VPS**, not `git push` (no webhook, no Dokploy/
Vercel). The normal release path is:

```bash
bun run ship "feat(scope): describe the verified change"
```

That command commits, regenerates the changelog, runs the push gates and out-of-tree
build, then builds in place, replaces the service process and verifies the served CSS
chunk. When launched through MSO/MCP, the gated push stays attached but finalization
is handed to the owner transient `mso-self-update.service` unit; otherwise replacing
`mso.service` would terminate the MCP call that launched it. Track completion with:

```bash
systemctl --user is-active mso-self-update.service
tail -f ~/.mso/self-update.log     # success ends with UPDATE OK
```

A direct manual build-and-replace remains available for recovery, but it bypasses the
release gates and should not be the normal path.

**`bun run build` now refuses when a live Next/MSO runtime serves the same checkout.**
`next start` loads the build manifest at boot; overwriting `.next` under the live
process makes the already-served HTML reference chunk hashes that no longer exist on
disk → every JS/CSS chunk 404/500s → **the live site is broken until you restart**.

Use `mso build` for the normal out-of-tree compile proof and `mso deploy` for a
production replacement. To test runtime behaviour without risking prod, use a
**separate checkout / a demo instance** on a different port — e.g. a build with `NEXT_PUBLIC_OS_DEMO=1` (no login,
no host access, forced mock data), served on `:4006` via its own systemd unit. For a
non-destructive static check, `bun run typecheck && bun run lint` is the cheap gate.

Recovery if a chunk mismatch is live: wait for any active self-update finalizer to
finish, then run `mso update --rebuild` and re-run the post-deploy smoke check.

## Package manager: bun installs, Node runs

**bun is the installer. The runtime is still Node 22** — `.nvmrc` and `engines.node`
mean what they say, and prod's `ExecStart` is `npm run start`. `next`, `tsc`, `eslint`
and `vitest` all ship a `#!/usr/bin/env node` shebang, and `bun run <script>` honours a
shebang, so the tools execute under Node exactly as before. Migrated from pnpm 10.32.1
on 2026-08-03; `bun.lock` is committed and `pnpm-lock.yaml` is gone.

Three things that will bite:

- **`bun run test`, never `bun test`.** `bun test` is bun's own builtin runner. It
  shadows the `test` script, ignores `vitest.config.mts` (losing the `**/zz-*` exclude
  and the named root includes for `proxy.test.ts` / `proxy-websocket.test.ts`), cannot
  run suites that use `vi.mock`, and **exits 0 having run nothing** — so `verify` goes
  green while testing zero files. Same trap in CI.
- **`node-pty` must stay in `trustedDependencies`.** It has no Linux prebuild, so it compiles at install time (hence the C++ toolchain + python3 requirement), and bun skips lifecycle scripts unless the package is trusted. Terminal code reaches it through the narrow `lib/host/terminal-api.ts` facade; unrelated routes no longer import a giant host barrel. Gate any dependency change on `node -e "require('node-pty')"` because PTY functionality is still release-critical.
- **Never `bunx`/`bun x` in a deploy script.** Unlike `pnpm exec`, bunx *downloads* a
  missing package and runs it. On the box that serves an authenticated remote shell,
  that turns a capability check into a fetch-and-execute. Call `node_modules/.bin/<tool>`
  directly (see `scripts/post-deploy-smoke.sh`).

`unrs-resolver` and `protobufjs` postinstalls stay **untrusted/blocked** — both work
from their prebuilt binaries. Don't "fix" the `bun pm untrusted` warning by trusting
them. `sharp` was a third entry until 0.35.0 removed its install script entirely; do
NOT add it to `trustedDependencies` to "restore" anything.
