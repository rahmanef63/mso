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
bash scripts/gates-12.sh full
bun run verify
node scripts/check-docs.mjs
bash scripts/verify-build.sh
```

**Start with `bash scripts/gates-12.sh full`.** It is the local mirror of the GitHub
Actions `verify` job: the same checks in the same order, so a red build shows up on your
machine instead of in your Actions minutes. `full` adds coverage, the production build and
every browser journey; the default `fast` mode is about two minutes and skips the slow
three.

A clean run ends with either of these, and both are green:

```text
mode=full  passed=17  failed=0  skipped=0
mode=full  passed=16  failed=0  skipped=1
```

The difference is the bundle budget, which `verify-build.sh` enforces inside the same run
rather than twice, so it reports as `SKIP` rather than `PASS`.

**Run only one `gates-12.sh` at a time per worktree.** Two concurrent `full` runs corrupt
each other in ways that look like real defects: vitest refuses to start because both
write the same `coverage/` directory, and `verify-build.sh` copies the tree into `/tmp`
per run, so two copies can exhaust the tmpfs. `fast` mode alongside `full` is also unsafe:
they share `/tmp/gate-out.txt`, so one run's failure text can appear under the other's
name.

`bun run verify` covers typecheck, lint, the Vitest suite, repository checks and the
high/critical dependency audit. `verify-build.sh` compiles a throwaway copy of `HEAD` so it
is safe even when the checkout is also the production WorkingDirectory.

Do **not** run a bare production build inside a live production checkout merely to prove
that code compiles; replacing `.next` underneath `next start` can create a chunk mismatch
until the service is replaced.

## Where the CI work actually runs

The `verify` job is fully reproducible locally; the security workflows are not yet, and
this is deliberate rather than an oversight:

| Workflow | Local equivalent |
| --- | --- |
| `ci.yml` `verify` | `bash scripts/gates-12.sh full` |
| `ci.yml` `native-host` (macOS/Windows) | not reproducible; needs those runners |
| `ci.yml` `dependency-watch` | `bun run audit:strict` plus `npm audit --prefix scripts/install/node-gyp --omit=dev --audit-level=high` |
| `security-core.yml` | partially: `docs/SELF-HOSTED-CI.md` lane is BLOCKED |
| `codeql.yml`, `dast.yml`, `dependency-review.yml`, `scorecard.yml`, `security-alerts.yml`, `codex-security.yml` | no local equivalent |

`bun run ci:plan` prints the repository-owned CI plan, and `bun run ci:verify --sha
"$(git rev-parse HEAD)"` runs it. The `security` and `release` profiles return **BLOCKED**
on purpose: the scanner adapters are written but not yet verified end to end, and a
blocked lane must never be reported as a pass. See
[`docs/SELF-HOSTED-CI.md`](./docs/SELF-HOSTED-CI.md) for the migration matrix and the
evidence rules.

You can still run the three scanners by hand with the exact image digests the workflows
pin. All three have been verified locally:

```bash
docker run --rm -v "$PWD:/src:ro" semgrep/semgrep@sha256:f1f7b71861c7b28b6e0f661225a2c4f58a484f5d0f182465c6d6b3b22f972ade \
  semgrep scan --metrics=off --config=p/javascript --config=p/typescript \
  --config=p/owasp-top-ten --strict --error \
  --exclude=node_modules --exclude=.next --exclude=coverage /src

docker run --rm -v "$PWD:/repo" zricethezav/gitleaks@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f \
  git --gitleaks-ignore-path /repo/.gitleaksignore /repo

docker run --rm -v "$PWD:/src:ro" ghcr.io/google/osv-scanner@sha256:8108ae94eadea5a02c9bec6e646909d5b790b44bd62d7f5b7f0b1d6d0ffc7734 \
  scan source --recursive /src
```

The `--exclude` flags are not decoration. CI scans a clean checkout; a working tree also
has `node_modules`, `.next` and `coverage`, and scanning those produces findings in
third-party code that CI never sees. Without them Semgrep reported **7 findings** here and
**0** with them.

Run the Gitleaks command **from the main checkout, not from a git worktree**. A worktree's
`.git` is a file pointing at the real git dir, so the scanner sees no repository and reports
`0 commits scanned` followed by `no leaks found`. That reads like a pass and proves nothing:
the same command in the main checkout scanned **1165 commits** and is the only form of the
check that means anything.

The OSV result depends on `bun.lock`. It reports `No issues found` on a tree that already
carries the `minimatch` override to 11.0.3, and two medium findings (`minimatch` 3.1.5 and
10.2.6) on one that does not. If you see those two, the fix exists and your base predates it,
so rebase rather than adding a second override block.

Two things these catch that the gates do not. Semgrep fails on a **parse warning** under
`--strict` even with zero findings, so a generic type argument on `await
importOriginal<...>()` in a test breaks the required check; apply the type with a cast on
its own `const` instead. Gitleaks scans all history, so a secret in an old commit fails the
check regardless of what your diff contains.

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
