#!/usr/bin/env bash
# The push gates. THIS FILE IS THE SOURCE OF TRUTH — the git hook is a one-liner
# that execs it.
#
# Why it lives here and not in .git/hooks/pre-push: a hook is untracked, so a fresh
# clone had NO gates at all, and a third-party hook installer silently
# overwrote the file — dropping the audit and build guards and re-adding a
# `check-slices.mjs` line for a script deleted on 2026-08-03, which blocks every
# push. Both failure modes were documented in CLAUDE.md, and a doc is not a control.
#
# Install (idempotent):  bash scripts/gates.sh --install
# Run by hand:           bash scripts/gates.sh
#
# A healthy run ends with BOTH of these lines. If either is missing, the wiring is
# gone — do not trust the push:
#   audit: clean at high/critical.
#   build: HEAD compiles (out-of-tree).
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Git exports repository-local environment variables to hooks (GIT_DIR,
# GIT_WORK_TREE, GIT_INDEX_FILE, object directories, and friends). The test suite
# intentionally creates temporary Git repositories; if those variables leak into a
# child `git init`, Git can operate on THIS repository instead of the fixture.
# Locate the root first, then clear only Git's documented local env so every child
# Git process discovers the repository from its own cwd.
while IFS= read -r git_local_var; do
  [ -n "$git_local_var" ] && unset "$git_local_var"
done < <(git rev-parse --local-env-vars 2>/dev/null || true)

if [ "${1-}" = "--install" ]; then
  HOOK="$(git rev-parse --git-path hooks/pre-push)"
  mkdir -p "$(dirname "$HOOK")"
  printf '#!/usr/bin/env bash\n# Thin shim — the gates live in scripts/gates.sh, which is committed.\nexec bash "$(git rev-parse --show-toplevel)/scripts/gates.sh"\n' > "$HOOK"
  chmod +x "$HOOK"
  echo "installed $HOOK → scripts/gates.sh"
  exit 0
fi

fail() { echo ""; echo "❌ $1 push blocked."; [ -n "${2-}" ] && echo "   $2"; exit 1; }

CURRENT_BRANCH="$(git branch --show-current 2>/dev/null || true)"
if [ "${MSO_GATE_FULL:-0}" != "1" ] && [ "${CI:-}" != "true" ] && [ -n "$CURRENT_BRANCH" ] && [ "$CURRENT_BRANCH" != "main" ] && [ "$CURRENT_BRANCH" != "master" ]; then
  echo "▶ running fast change-aware gate on feature branch '${CURRENT_BRANCH}' (set MSO_GATE_FULL=1 for full release gate)"
  node scripts/run-smart-gate.mjs --pr-fast || fail "smart gate failed." "reproduce: bun run gate:smart -- --pr-fast"
  exit 0
fi

# ── Guard 1 — typecheck + lint + test + architecture/docs/features/contrast checks.
# MSO is self-contained: a fresh clone must never depend on a sibling/private repo
# to decide whether it is safe to push. `bun run verify` is the canonical in-repo gate.
# (check-cycles, check-architecture, check-features, check-docs, check-contrast already
# run inside `bun run verify` -> `bun run check`, so they are not duplicated below.)
echo "▶ running MSO verify"
bun run verify || fail "verify failed." "reproduce: bun run verify"

# ── Guard 1b — changelog freshness guard (explicitly retained for direct `git push`).
# NOTE: check-slices.mjs used to run here. It and all 20 slice.json were deleted on
# 2026-08-03 (commit 844eef3) and replaced by scripts/check-features.mjs in `bun run check`.
node scripts/gen-changelog.mjs --check || fail "changelog stale — run: node scripts/gen-changelog.mjs (or use \`bun run ship\`)."

# ── Guard 1c — dependency audit, high/critical only.
# Must live HERE rather than rely on an external CI wrapper. The audit wrapper
# can skip locally, but a release gate must fail closed on missing evidence.
node scripts/audit.mjs --strict || fail "audit: high/critical advisory or incomplete registry evidence."

# ── Guard 1d — build. Never build in THIS directory: `next build` wipes .next
# before compiling, while the live :4005 process may be serving from it.
# verify-build.sh compiles a throwaway copy of HEAD instead.
MSO_GATE_BUILD_LOG="$(mktemp)"
if bash scripts/verify-build.sh >"$MSO_GATE_BUILD_LOG" 2>&1; then
  rm -f "$MSO_GATE_BUILD_LOG"
  echo "build: HEAD compiles (out-of-tree)."
  echo "browser: required release journeys passed (synthetic stores)."
else
  tail -n 60 "$MSO_GATE_BUILD_LOG" >&2
  rm -f "$MSO_GATE_BUILD_LOG"
  fail "build or browser journey failed." "reproduce: bash scripts/verify-build.sh"
fi
