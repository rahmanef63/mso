#!/usr/bin/env bash
# The push gates. THIS FILE IS THE SOURCE OF TRUTH — the git hook is a one-liner
# that execs it.
#
# Why it lives here and not in .git/hooks/pre-push: a hook is untracked, so a fresh
# clone had NO gates at all, and re-running an sc-git hook installer silently
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
  HOOK="$ROOT/.git/hooks/pre-push"
  mkdir -p "$(dirname "$HOOK")"
  printf '#!/usr/bin/env bash\n# Thin shim — the gates live in scripts/gates.sh, which is committed.\nexec bash "$(git rev-parse --show-toplevel)/scripts/gates.sh"\n' > "$HOOK"
  chmod +x "$HOOK"
  echo "installed $HOOK → scripts/gates.sh"
  exit 0
fi

fail() { echo ""; echo "❌ $1 push blocked."; [ -n "${2-}" ] && echo "   $2"; exit 1; }

# ── Guard 1 — typecheck + lint + test.
# sc-git's ci.js is used when present (it is the shared runner across this owner's
# repos) but must not be REQUIRED: a fresh clone on another machine has no such
# path, and silently skipping the whole guard there is exactly the hole this file
# exists to close. `bun run verify` is the in-repo equivalent.
SC_CI="/home/rahman/projects/opensource/si-coder-agent/skills/sc-git/scripts/ci.js"
if [ -f "$SC_CI" ]; then
  node "$SC_CI" --skip build || fail "sc-git ci failed." "override (NOT recommended): git push --no-verify"
else
  echo "▶ sc-git ci.js not present — running \`bun run verify\` instead"
  bun run verify || fail "verify failed." "reproduce: bun run verify"
fi

# ── Guard 1b — architecture. check-contrast is informational (a WCAG palette audit
# is a design task, not a push blocker), so it is allowed to exit non-zero.
# NOTE: check-slices.mjs used to run here. It and all 20 slice.json were deleted on
# 2026-08-03 (commit 844eef3) — do NOT let a hook reinstall re-add that line.
node scripts/check-cycles.mjs || fail "check-cycles: new import cycle introduced."
# docs/CHANGELOG.md is derived from git, so it can only be stale, never wrong —
# and a stale one is what Settings → About would show. `bun run ship` regenerates
# it before committing; this catches a plain `git push`.
node scripts/gen-changelog.mjs --check || fail "changelog stale — run: node scripts/gen-changelog.mjs (or use \`bun run ship\`)."
node scripts/check-contrast.mjs || true

# ── Guard 1c — dependency audit, high/critical only.
# Must live HERE rather than lean on ci.js: that runner has a hardcoded
# STEPS=['typecheck','lint','test','build'] and never invokes `verify`. The wrapper
# skips (exit 0) when the registry is unreachable, so a network blip cannot fake a
# CVE and block a push.
node scripts/audit.mjs || fail "audit: unignored high/critical advisory."

# ── Guard 1d — build. ci.js above keeps `--skip build` ON PURPOSE: it would build in
# THIS directory, and `next build` wipes .next before compiling — which is what the
# live :4005 process is serving from. verify-build.sh compiles a throwaway copy of
# HEAD instead. Adds ~35 s to a push; if that ever becomes intolerable, DELETE this
# guard rather than "fixing" it by letting ci.js build in place.
bash scripts/verify-build.sh >/dev/null 2>&1 \
  && echo "build: HEAD compiles (out-of-tree)." \
  || fail "build failed." "reproduce: bash scripts/verify-build.sh"

# ── Guard 2 — self-hosted Convex auto-deploy. A silent no-op in this repo (there is
# no convex/ directory); kept so the file matches the shared sc-git shape and a
# future backend does not have to rediscover the ordering rule: backend first, or
# the frontend lands ahead of it.
if [ -d convex ] && [ -f .env.local ] \
   && grep -q "^CONVEX_SELF_HOSTED_URL=" .env.local 2>/dev/null \
   && grep -q "^CONVEX_SELF_HOSTED_ADMIN_KEY=" .env.local 2>/dev/null; then
  LOCAL_SHA=$(git rev-parse HEAD 2>/dev/null || true)
  REMOTE_SHA=$(git rev-parse origin/main 2>/dev/null || echo "")
  if [ -n "$REMOTE_SHA" ] && [ "$LOCAL_SHA" != "$REMOTE_SHA" ] \
     && [ -n "$(git diff --name-only "$REMOTE_SHA"..HEAD -- convex/ 2>/dev/null || true)" ]; then
    echo ""
    echo "▶ convex/ changed → deploying self-hosted Convex FIRST"
    set -a; . ./.env.local; set +a
    pnpm exec convex deploy --yes \
      || fail "Convex self-hosted deploy failed." "do NOT --no-verify — the frontend would land ahead of the backend."
    echo "✓ Convex deploy complete. Continuing push."
  fi
fi
