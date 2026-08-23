# Contributing

MSO is a focused, single-owner project. Issues and pull requests are welcome, but changes
should preserve the narrow security and deployment model.

## Setup

```bash
bun install
cp .env.example .env.local
bun run dev
```

Set `OS_LOGIN_PASSWORD` and `OS_SESSION_SECRET` for live auth. The mock adapters let most UI
work proceed without VPS credentials or host access.

## Before a PR

Run:

```bash
bun run verify
node scripts/check-docs.mjs
bash scripts/verify-build.sh
```

`bun run verify` covers typecheck, lint, the Vitest suite, repository checks and the
high/critical dependency audit. `verify-build.sh` compiles a throwaway copy of `HEAD` so it
is safe even when the checkout is also the production WorkingDirectory.

Do **not** run a bare production build inside a live production checkout merely to prove
that code compiles; replacing `.next` underneath `next start` can create a chunk mismatch
until the service is replaced.

The committed source of truth for pre-push policy is `scripts/gates.sh`. The actual
`.git/hooks/pre-push` file is intentionally a tiny untracked shim. Install/reinstall it with:

```bash
bash scripts/gates.sh --install
```

A healthy push runs the shared typecheck/lint/test path (or in-repo fallback), cycle/docs/
changelog checks, dependency audit and the out-of-tree build. It should end with both:

```text
audit: clean at high/critical.
build: HEAD compiles (out-of-tree).
```

The GitHub CI workflow is still useful for a clean-checkout dependency/install proof,
especially after changes to `package.json`, `bun.lock` or installer/release scripts.

## Conventions

The current architecture is in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) and the
documentation map is [`docs/README.md`](./docs/README.md). Reviewers will hold changes to
these rules:

- vertical application slices live under `frontend/slices/<slug>/`;
- cross-slice imports use public barrels;
- host operations flow through `lib/host` instead of reimplementing path/process guards in
  routes or components;
- keep files small/single-purpose where practical and use the existing UI primitives/tokens;
- keep responsive/mobile behaviour first-class;
- preserve the single catch-all app routing model;
- use conventional commit subjects.

When you add/remove/rename a current capability, update the relevant current reference doc
in the same change. `scripts/check-docs.mjs` catches selected machine-verifiable drift but
cannot infer every semantic change.

## Releasing maintainer changes

Normal contributor PRs should not deploy production. The maintainer release path after a
verified merge is:

```bash
bun run ship "feat(scope): describe the verified change"
```

A Git push by itself is not deployment. See [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md).

## Security issues

Do not open a public issue containing exploit details or secrets. Follow
[`SECURITY.md`](./SECURITY.md).
