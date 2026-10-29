#!/usr/bin/env bash
# 12-gate pre-push check, run explicitly and reported one line per gate so a
# push decision does not depend on reading a 1800-line log. Mirrors scripts/gates.sh
# plus the perf/bundle/instance checks that gates.sh reaches indirectly through
# `bun run verify`.
set -u
cd "$(dirname "$0")/.." || exit 1
pass=0; fail=0; rows=""

run() { # name, command...
  local name="$1"; shift
  if "$@" >/tmp/gate-out.txt 2>&1; then
    rows="${rows}${name}|PASS|$(tail -1 /tmp/gate-out.txt | cut -c1-90)\n"; pass=$((pass+1))
  else
    rows="${rows}${name}|FAIL|$(tail -3 /tmp/gate-out.txt | tr '\n' ' ' | cut -c1-110)\n"; fail=$((fail+1))
  fi
}

run "1/12 typecheck"        npx tsc --noEmit
run "2/12 lint"             npx eslint . --max-warnings=0
run "3/12 unit tests"       npx vitest run
run "4/12 import cycles"    node scripts/check-cycles.mjs
run "5/12 architecture"     node scripts/check-architecture.mjs
run "6/12 docs currency"    node scripts/check-docs.mjs
run "7/12 changelog"        node scripts/gen-changelog.mjs --check
run "8/12 contrast"         node scripts/check-contrast.mjs
run "9/12 bundle budget"    node scripts/check-bundle.mjs
run "10/12 instance guard"  node scripts/check-instance-literals.mjs
run "11/12 audit strict"    node scripts/audit.mjs --strict
run "12/12 ci contract"     node --test scripts/ci/contract.node.mjs

printf "%-20s %-5s %s\n" GATE RESULT DETAIL
# Here-string, not a pipe: a piped `while` runs in a subshell and the rows would
# print but the loop would then be invisible to anything after it.
while IFS='|' read -r name res detail; do
  [ -n "$name" ] && printf "%-20s %-5s %s\n" "$name" "$res" "$detail"
done <<< "$(printf '%b' "$rows")"
echo
echo "passed $pass / 12, failed $fail"
[ "$fail" -eq 0 ]
