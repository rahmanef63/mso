#!/usr/bin/env bash
# Local mirror of the GitHub Actions `verify` job.
#
# Why this exists separately from scripts/gates.sh: the pre-push hook must stay fast
# (it runs on every push), while this is the "would CI pass?" check to run before
# opening a PR. They drifted once — the hook ran `vitest run` while CI ran
# `vitest run --coverage`, whose thresholds are a real gate — and a green local run
# then failed in CI. This file lists the CI steps explicitly so the drift is visible
# in the source rather than discovered from a red build.
#
# Stages:
#   fast   (default) the deterministic, no-browser checks. ~2 min.
#   full   adds coverage, the production build, and every browser journey. ~15 min.
#   --ci   prints the CI step names alongside the local equivalent, for auditing.
set -u
cd "$(dirname "$0")/.." || exit 1

MODE="${1:-fast}"
pass=0; fail=0; skipped=0; rows=""

run() { # name, command...
  local name="$1"; shift
  if timeout 1800 "$@" >/tmp/gate-out.txt 2>&1; then
    rows="${rows}${name}|PASS|$(tail -1 /tmp/gate-out.txt | cut -c1-88)\n"; pass=$((pass+1))
  else
    rows="${rows}${name}|FAIL|$(tail -3 /tmp/gate-out.txt | tr '\n' ' ' | cut -c1-108)\n"; fail=$((fail+1))
  fi
}

skip() { local name="$1" why="$2"; rows="${rows}${name}|SKIP|${why}\n"; skipped=$((skipped+1)); }

# ── Deterministic checks. These are the same commands CI runs. ───────────────
run "typecheck"          npx tsc --noEmit
run "lint"               npx eslint . --max-warnings=0
run "installer syntax"   bash -c 'bash -n scripts/install.sh && bash -n scripts/install-core.sh'
run "native dependency"  node -e "require('node-pty')"
run "cycles"             node scripts/check-cycles.mjs
run "architecture"       node scripts/check-architecture.mjs
run "docs"               node scripts/check-docs.mjs
run "changelog"          node scripts/gen-changelog.mjs --check
run "contrast"           node scripts/check-contrast.mjs
run "bundle budget"      node scripts/check-bundle.mjs
run "instance guard"     node scripts/check-instance-literals.mjs
run "audit strict"       node scripts/audit.mjs --strict
run "ci contract"        node --test scripts/ci/contract.node.mjs

# ── Coverage. CI runs `bun run coverage`, which enforces vitest.config.mts
# thresholds (statements 42 / branches 40 / functions 32 / lines 43.5). Running
# plain `vitest run` locally misses those, which is exactly how the drift started.
if [ "$MODE" != "fast" ]; then
  run "tests + coverage" bun run coverage
else
  run "tests"            npx vitest run
  # Coverage thresholds are a CI gate; say plainly that this mode did not check them.
  skip "coverage thresholds" "fast mode runs vitest without --coverage; use 'full' before a PR"
fi

# ── Build and browser journeys. CI does all of this on a fresh runner.
if [ "$MODE" = "full" ]; then
  run "forge sandbox"    bash scripts/provision-forge-sandbox.sh
  # Out-of-tree: an in-place build deletes .next/static and takes down the live :4005.
  run "production build" bash scripts/verify-build.sh
  run "perf gate"        node scripts/check-perf.mjs
else
  skip "production build" "out-of-tree build takes ~10 min; run 'gates-12.sh full'"
  skip "browser journeys" "needs a build; run 'gates-12.sh full'"
  skip "perf gate"        "needs a browser run; use 'full' or 'node scripts/check-perf.mjs'"
fi

printf "%-26s %-5s %s\n" GATE RESULT DETAIL
while IFS='|' read -r name res detail; do
  [ -n "$name" ] && printf "%-26s %-5s %s\n" "$name" "$res" "$detail"
done <<< "$(printf '%b' "$rows")"
echo
echo "mode=$MODE  passed=$pass  failed=$fail  skipped=$skipped"
[ "$fail" -eq 0 ]
