# Deploy probe still asserted the dead `/_next/static/*` namespace

`scripts/e2e/smoke.production.ts` is the live deploy probe (`bun run smoke`). Its asset
journey regex-matched `/_next/static/*` in the served home HTML and asserted at least one
match. The Svelte cutover (`0c324015`) deleted Next.js and the adapter now writes
content-hashed output to `_app/immutable/`, so the regex matched nothing, `assets.length`
was `0`, and the assertion failed with "no _next/static JS/CSS assets found in home HTML".
Every URL in that list would also have 404'd if the regex had matched, since `proxy.ts`
returns `notFound()` for `/_next/*`.

That gate therefore could not pass against any post-cutover build. It did not surface in
CI because nothing in `ci.yml` runs the `scripts/e2e` vitest config; it stayed visible only
as a probe no one could run green.

## Change

`scripts/e2e/smoke.production.ts` now matches `/_app/immutable/` and the assertion message
names that namespace. The test name, the 120-asset ceiling and the MIME assertions are
unchanged; only the namespace moved with the build output.

## Verification

Against a production build of this tree (`bun run svelte:build`, then
`node scripts/server.mjs --port <port>`), with `E2E_BASE_URL` pointed at it:

    bunx vitest run --config scripts/e2e/vitest.config.mts
    Test Files  2 passed (2)
    Tests  5 passed (5)

Red/green pair, same server and same report: `origin/main`'s copy of the file fails the
journey (`expected 0 to be greater than 0`, no `/_next/static` assets in home HTML), while
this version passes. Unit suites unchanged: `bunx vitest run scripts/ lib/http` is
218 files / 1289 tests passed.

## Not fixed here

`scripts/e2e/bundle-performance.mjs` is also dead, but not from a path alone. It reads
`.next/static/chunks` (ENOENT), matches `/_next/static/` at three call sites, never signs
in to the password-gated fixture (so it asserted against the login page), and drives UI
that no longer exists: a "Spotlight search" combobox, a "Server connection mode" control
from the old Next chrome, and a "Close inspector (⌘I)" button. Repairing it is a journey
rewrite against the current shell, not a rename, so it is left as-is here rather than
half-migrated. It is referenced by `scripts/e2e/manifest.mjs` and
`scripts/worktree-gates.test.ts` but is not executed by `ci.yml` or `verify-build.sh`.
