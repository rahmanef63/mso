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

# ── Guard 1 — typecheck + lint + test.
# MSO is self-contained: a fresh clone must never depend on a sibling/private repo
# to decide whether it is safe to push. `bun run verify` is the canonical in-repo gate.
echo "▶ running MSO verify"
bun run verify || fail "verify failed." "reproduce: bun run verify"

# ── Guard 1b — architecture. check-contrast is informational (a WCAG palette audit
# is a design task, not a push blocker), so it is allowed to exit non-zero.
# NOTE: check-slices.mjs used to run here. It and all 20 slice.json were deleted on
# 2026-08-03 (commit 844eef3) — do NOT let a hook reinstall re-add that line.
node scripts/check-cycles.mjs || fail "check-cycles: new import cycle introduced."
node scripts/check-docs.mjs || fail "documentation drift detected." "fix current docs or their machine-readable markers before pushing."
# docs/CHANGELOG.md is derived from git, so it can only be stale, never wrong —
# and a stale one is what Settings → About would show. `bun run ship` regenerates
# it before committing; this catches a plain `git push`.
node scripts/gen-changelog.mjs --check || fail "changelog stale — run: node scripts/gen-changelog.mjs (or use \`bun run ship\`)."
node scripts/check-contrast.mjs || true

# ── Guard 1c — dependency audit, high/critical only.
# Must live HERE rather than rely on an external CI wrapper. The audit wrapper
# can skip locally, but a release gate must fail closed on missing evidence.
node scripts/audit.mjs --strict || fail "audit: high/critical advisory or incomplete registry evidence."

# ── Guard 1d — build. Never build in THIS directory: `next build` wipes .next
# before compiling, while the live :4005 process may be serving from it.
# verify-build.sh compiles a throwaway copy of HEAD instead.
bash scripts/verify-build.sh >/dev/null 2>&1 \
  && echo "build: HEAD compiles (out-of-tree)." \
  || fail "build failed." "reproduce: bash scripts/verify-build.sh"
