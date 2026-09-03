#!/usr/bin/env bash
# self-update.sh — inner pull/verify/build/restart stage. All public update entry points
# go through scripts/mso-service-update first so checkout runtime inventory/locks are enforced.
#
# RUN BY systemd-run --user, NOT by mso.service (lib/host/self-update.ts explains
# why: replacing mso.service kills that service's whole cgroup, so an updater child
# would die mid-build with .next already deleted). The user unit survives, signals
# mso.service's same-UID MainPID, and Restart=always starts the freshly-built app.
#
# Order is the same load-bearing order as scripts/ship.sh, with ONE addition: the
# out-of-tree verification. ship.sh is run by a human who is watching; this is run by
# an operator who pressed a button and walked away, so a commit that does not compile
# must be found BEFORE `next build` deletes the .next the live service is serving
# from. That build is unrecoverable in place — there is no old .next to put back.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)" || exit 1
cd "$ROOT" || exit 1
# shellcheck source=scripts/lib/update-git-authority.sh
. "$ROOT/scripts/lib/update-git-authority.sh"

LOG="${MSO_UPDATE_LOG:-$HOME/.mso/self-update.log}"
mkdir -p "$(dirname "$LOG")"
# Truncate, then take over both streams: the panel polls this file, and a log that
# grew forever would eventually be the biggest thing in ~/.mso.
exec >"$LOG" 2>&1

# systemd hands a unit /usr/local/sbin:…:/usr/bin and nothing else. bun lives in
# ~/.bun/bin — the same gap that made managed apps read as "not installed".
export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"
export NO_COLOR=1 TERM=dumb

step() { printf '\n[%s] == %s\n' "$(date -Is)" "$*"; }
die()  { printf '\n[%s] FAILED: %s\n' "$(date -Is)" "$*"; printf 'the running MSO was left untouched.\n'; exit 1; }

REBUILD_ONLY=0
SHIP_FINALIZE=0
case "${1:-}" in
  "") ;;
  --rebuild-only) REBUILD_ONLY=1 ;;
  --ship-finalize) REBUILD_ONLY=1; SHIP_FINALIZE=1 ;;
  *) die "unknown mode: ${1:-}" ;;
esac

step "self-update starting (rebuild-only=$REBUILD_ONLY, ship-finalize=$SHIP_FINALIZE)"
HEAD_SHA="$(git rev-parse HEAD 2>/dev/null || true)"
[ -n "$HEAD_SHA" ] || die "could not read checkout HEAD"
CURRENT_BRANCH="$(git branch --show-current 2>/dev/null || true)"
[ "$CURRENT_BRANCH" = main ] || die "updates require checkout to be on main (current: ${CURRENT_BRANCH:-detached HEAD})"
printf 'at %s\n' "${HEAD_SHA:0:7}"

if [ "$SHIP_FINALIZE" -eq 1 ]; then
  EXPECTED_SHA="${MSO_EXPECTED_SHA:-}"
  [ "${#EXPECTED_SHA}" -eq 40 ] \
    || die "ship finalizer requires an exact 40-character MSO_EXPECTED_SHA"
  case "$EXPECTED_SHA" in
    *[!0-9a-f]*) die "ship finalizer requires an exact 40-character MSO_EXPECTED_SHA" ;;
  esac
  [ "$HEAD_SHA" = "$EXPECTED_SHA" ] || die "checkout HEAD changed after the release gates"
  [ "$(git rev-parse origin/main 2>/dev/null || true)" = "$EXPECTED_SHA" ] \
    || die "origin/main no longer matches the release SHA"
  [ -z "$(git status --porcelain)" ] \
    || die "checkout changed after verification; refusing to build uncommitted bytes"
fi

if [ "$REBUILD_ONLY" -eq 0 ]; then
  step "fetching origin/main"
  git fetch --quiet origin main || die "could not reach the remote"
  step "verifying remote authority / fast-forwarding"
  read -r RELATION AHEAD_COUNT BEHIND_COUNT < <(update_git_relation "$ROOT") \
    || die "could not compare checkout with origin/main"
  case "$RELATION" in
    exact) ;;
    behind) git merge --ff-only origin/main || die "cannot fast-forward — the checkout has diverged from origin/main" ;;
    ahead) die "local main is ahead of origin/main by $AHEAD_COUNT commit(s); refusing to deploy unpushed code" ;;
    diverged) die "local main has diverged from origin/main (ahead $AHEAD_COUNT, behind $BEHIND_COUNT)" ;;
    *) die "unknown Git authority state" ;;
  esac
  read -r RELATION AHEAD_COUNT BEHIND_COUNT < <(update_git_relation "$ROOT") \
    || die "could not re-check origin/main after fast-forward"
  [ "$RELATION" = exact ] || die "checkout does not exactly match origin/main after update"
  git log -1 --format='now at %h — %s'

  step "installing dependencies"
  # Cheap when nothing changed (~250ms), and a pulled commit may have moved a
  # dependency. node-pty is in trustedDependencies, so its native build runs here.
  bun install || die "bun install failed"
  node -e "require('node-pty')" || die "node-pty did not load after install — every /api/v1 route imports it"
fi

if [ "$SHIP_FINALIZE" -eq 1 ]; then
  step "using the exact commit already proven by the pre-push out-of-tree build"
  [ "$(git rev-parse HEAD)" = "$EXPECTED_SHA" ] && [ -z "$(git status --porcelain)" ] \
    || die "checkout moved before the in-place build"
else
  step "verifying the build out-of-tree (this does not touch the live .next)"
  bash scripts/verify-build.sh >/dev/null || die "HEAD does not compile — nothing was deployed"
fi

step "building in place"
node node_modules/next/dist/bin/next build >/dev/null || die "in-place build failed — check disk space"

step "restarting mso.service (same-user signal; no sudo)"
# mso.service runs as the owner and has Restart=always. Signalling its MainPID is
# therefore the least-privilege equivalent of `systemctl restart`: systemd cleans
# the rest of that service cgroup and starts it again, while this updater lives in a
# separate USER-manager cgroup and survives. Verify the uid before signalling so a
# hand-edited unit can never turn this into a cross-user kill.
RESTART_POLICY="$(systemctl show -p Restart --value mso.service 2>/dev/null || true)"
[ -n "$RESTART_POLICY" ] && [ "$RESTART_POLICY" != "no" ] \
  || die "mso.service has no automatic restart policy"
OLD_PID="$(systemctl show -p MainPID --value mso.service 2>/dev/null || true)"
case "$OLD_PID" in
  ""|*[!0-9]*) die "could not read mso.service MainPID" ;;
esac
[ "$OLD_PID" -gt 1 ] || die "mso.service has no running MainPID"
SELF_UID="$(id -u)"
PID_UID="$(stat -c %u "/proc/$OLD_PID" 2>/dev/null || true)"
[ "$PID_UID" = "$SELF_UID" ] || die "mso.service MainPID $OLD_PID belongs to uid ${PID_UID:-unknown}, not $SELF_UID"
kill -TERM "$OLD_PID" || die "could not signal mso.service MainPID $OLD_PID"

# A system service can legitimately spend close to TimeoutStopSec draining the old
# control group before Restart=always creates the replacement. The installed MSO
# unit currently inherits systemd's 90 s TimeoutStopSec; the old fixed 40 s loop
# could therefore declare failure while systemd was still correctly stopping the
# old Next/npm process, then the new service would appear seconds later. Keep a
# bounded but realistic verification budget. The override is intentionally narrow
# (30..300 s) so a typo cannot make the release finalizer hang forever.
RESTART_WAIT_SECONDS="${MSO_SERVICE_RESTART_WAIT_SECONDS:-120}"
case "$RESTART_WAIT_SECONDS" in
  ""|*[!0-9]*) die "MSO_SERVICE_RESTART_WAIT_SECONDS must be an integer from 30 to 300" ;;
esac
[ "$RESTART_WAIT_SECONDS" -ge 30 ] && [ "$RESTART_WAIT_SECONDS" -le 300 ] \
  || die "MSO_SERVICE_RESTART_WAIT_SECONDS must be an integer from 30 to 300"
RESTART_DEADLINE=$((SECONDS + RESTART_WAIT_SECONDS))
NEW_PID=""
while [ "$SECONDS" -lt "$RESTART_DEADLINE" ]; do
  CANDIDATE="$(systemctl show -p MainPID --value mso.service 2>/dev/null || true)"
  case "$CANDIDATE" in
    ""|*[!0-9]*) ;;
    *)
      if [ "$CANDIDATE" -gt 1 ] && [ "$CANDIDATE" != "$OLD_PID" ] && systemctl is-active --quiet mso.service; then
        NEW_PID="$CANDIDATE"
        break
      fi
      ;;
  esac
  sleep 1
done
[ -n "$NEW_PID" ] \
  || die "mso.service did not return with a new MainPID within ${RESTART_WAIT_SECONDS}s; release state is unverified — inspect the system unit before retrying"
printf 'restarted %s -> %s after %ss\n' "$OLD_PID" "$NEW_PID" "$((RESTART_WAIT_SECONDS - (RESTART_DEADLINE - SECONDS)))"

# Verify the COMPLETE static asset graph referenced by root HTML. A healthy first
# stylesheet is insufficient: an in-place build can leave one old JS chunk missing
# while other assets still serve correctly. The helper is bounded and checks
# status + MIME for every referenced root JS/CSS asset.
SERVICE_PORT="$(systemctl show -p Environment --value mso.service 2>/dev/null \
  | tr ' ' '\n' | sed -n 's/^PORT=//p' | head -1)"
PORT="${PORT:-${SERVICE_PORT:-4005}}"
ASSET_BASE="http://127.0.0.1:$PORT"
node scripts/check-served-assets.mjs "$ASSET_BASE" \
  || die "served static asset graph is inconsistent after replacement; use the supported MSO deploy/rebuild lifecycle and inspect ~/.mso/self-update.log"

step "inner update stage complete — now at $(git rev-parse --short HEAD)"
printf 'INNER STAGE COMPLETE\n'
