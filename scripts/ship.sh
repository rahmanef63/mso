#!/usr/bin/env bash
# The whole ship, in the order that cannot be got wrong.
#
#   bun run ship
#
# Exists because "push to main" is NOT a deploy here. Prod is systemd with no
# webhook, so a pushed commit changes nothing the owner can see until someone
# rebuilds — and the rebuild has a hazard of its own (`next build` wipes .next in
# the LIVE working directory, so the site 404s every chunk until the restart lands).
# Doing it by hand meant remembering four steps in one order; forgetting the last
# one left main ahead of the running site with no signal that they had diverged.
#
# Order is load-bearing, and the changelog step is subtler than it looks:
#   1. commit      — the message must be IN history before the changelog can list it.
#   2. changelog   — regenerate, then fold into that same commit with --amend. The
#                    amend rewrites the SHA, which is exactly why gen-changelog.mjs
#                    emits no hashes: the content has to survive it, or the staleness
#                    gate would disagree with itself on the next push.
#   3. push        — the pre-push hook runs the gates (scripts/gates.sh), including
#                    the changelog staleness check that this ordering satisfies.
#   4. build       — in place, because the next line restarts immediately.
#   5. restart     — build THEN restart, always. Never the reverse.
#
# When invoked THROUGH MSO/MCP, steps 4–5 cannot remain a child of mso.service:
# restarting the service kills its whole cgroup, including nohup children and this
# script before it can verify the new chunks. After the gated push, that case hands
# rebuild/restart/verification to the same owner transient user unit used by the
# Settings self-updater. An SSH/terminal invocation stays synchronous.
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

MSG="${1:-}"
[ -n "$MSG" ] || { echo "usage: bun run ship \"<conventional commit message>\"" >&2; exit 1; }

echo "▶ 1/5 commit"
git add -A
# A failed push leaves the commit behind — the gates run AFTER it. Re-running with
# the same message would then stack a duplicate, which is exactly what happened the
# first time this script ran: two identical subjects, and the changelog listed the
# change twice. Amend instead, but ONLY when HEAD is unpushed and carries the same
# subject, so this can never rewrite something already on origin.
AMEND=""
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main 2>/dev/null || echo none)" ]    && [ "$(git log -1 --format=%s)" = "$(printf '%s' "$MSG" | head -1)" ]; then
  echo "  HEAD is an unpushed commit with this subject — amending rather than duplicating"
  AMEND="--amend"
fi
if [ -z "$AMEND" ] && git diff --cached --quiet; then
  echo "  nothing staged — skipping commit"
  COMMITTED=0
else
  git commit -q $AMEND -m "$MSG"
  COMMITTED=1
fi

echo "▶ 2/5 changelog"
node scripts/gen-changelog.mjs
if ! git diff --quiet -- docs/CHANGELOG.md; then
  git add docs/CHANGELOG.md
  if [ "$COMMITTED" = "1" ]; then
    git commit -q --amend --no-edit   # fold it into the commit it describes
  else
    git commit -q -m "docs(changelog): regenerate"
  fi
fi

echo "▶ 3/5 push (gates run here, ~70s)"
git push origin main

inside_mso_service() {
  [ "${MSO_SHIP_FORCE_HANDOFF:-0}" = "1" ] && return 0
  grep -Eq '(^|/)mso\.service($|/)' /proc/self/cgroup 2>/dev/null
}

RELEASE_SHA="$(git rev-parse HEAD)"
echo "▶ 4/5 hand off exact-SHA build/restart to owner user unit"
HANDOFF="$(bash scripts/ship-handoff.sh "$PWD" "$RELEASE_SHA")"
printf '%s\n' "$HANDOFF"
RELEASE_LOG="$(printf '%s\n' "$HANDOFF" | sed -n 's/^release_log=//p' | tail -1)"

if inside_mso_service; then
  echo "▶ 5/5 restart and chunk verification continue outside mso.service"
  echo
  echo "✅ pushed ${RELEASE_SHA:0:7}; deployment finalizer is running"
  echo "   Poll the returned user unit and log; this message means scheduled, not deployed."
  exit 0
fi

echo "▶ 5/5 wait for restart and chunk verification"
while systemctl --user is-active --quiet mso-self-update.service; do sleep 1; done
[ -n "$RELEASE_LOG" ] && [ -f "$RELEASE_LOG" ] \
  || { echo "❌ release finalizer produced no log" >&2; exit 1; }
if ! tail -n 8 "$RELEASE_LOG" | grep -q '^UPDATE OK$'; then
  tail -n 80 "$RELEASE_LOG" >&2
  echo "❌ release finalizer failed" >&2
  exit 1
fi

echo
echo "✅ shipped ${RELEASE_SHA:0:7} → ${OS_PUBLIC_ORIGIN:-http://localhost:4005}"
echo "   What's new is in Settings → About (docs/CHANGELOG.md, regenerated above)."
