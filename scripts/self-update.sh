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
printf 'at %s
' "${HEAD_SHA:0:7}"

if [ "$SHIP_FINALIZE" -eq 1 ]; then
  EXPECTED_SHA="${MSO_EXPECTED_SHA:-}"
  [ "${#EXPECTED_SHA}" -eq 40 ]     || die "ship finalizer requires an exact 40-character MSO_EXPECTED_SHA"
  case "$EXPECTED_SHA" in
    *[!0-9a-f]*) die "ship finalizer requires an exact 40-character MSO_EXPECTED_SHA" ;;
  esac
  [ "$HEAD_SHA" = "$EXPECTED_SHA" ] || die "checkout HEAD changed after the release gates"
  [ "$(git rev-parse origin/main 2>/dev/null || true)" = "$EXPECTED_SHA" ]     || die "origin/main no longer matches the release SHA"
  [ -z "$(git status --porcelain)" ]     || die "checkout changed after verification; refusing to build uncommitted bytes"
fi

if [ "$REBUILD_ONLY" -eq 0 ]; then
  step "fetching origin/main"
  git fetch --quiet origin main || die "could not reach the remote"
  step "fast-forwarding"
  # --ff-only, never a merge: this checkout must stay a mirror of main. A refusal
  # here means someone committed on the host, and silently merging their work into
  # a deploy is worse than stopping.
  git merge --ff-only origin/main || die "cannot fast-forward — the checkout has diverged from origin/main"
  git log -1 --format='now at %h — %s'

  step "installing dependencies"
  # Cheap when nothing changed (~250ms), and a pulled commit may have moved a
  # dependency. node-pty is in trustedDependencies, so its native build runs here.
  bun install || die "bun install failed"
  node -e "require('node-pty')" || die "node-pty did not load after install — every /api/v1 route imports it"
fi

if [ "$SHIP_FINALIZE" -eq 1 ]; then
  step "using the exact commit already proven by the pre-push out-of-tree build"
  [ "$(git rev-parse HEAD)" = "$EXPECTED_SHA" ] && [ -z "$(git status --porcelain)" ]     || die "checkout moved before the in-place build"
else
  step "verifying the build out-of-tree (this does not touch the live .next)"
  bash scripts/verify-build.sh >/dev/null || die "HEAD does not compile — nothing was deployed"
fi

step "building in place"
bun run build >/dev/null || die "in-place build failed — check disk space"

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

NEW_PID=""
for _ in $(seq 1 40); do
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
[ -n "$NEW_PID" ] || die "mso.service did not come back with a new MainPID"
printf 'restarted %s -> %s\n' "$OLD_PID" "$NEW_PID"

# The chunk-mismatch check CLAUDE.md warns about, verified rather than remembered —
# the same check scripts/ship.sh ends with. `active` only means npm has started, not
# that Next is already accepting connections, so wait for real HTML before checking
# its referenced CSS chunk.
# The user transient unit intentionally does not inherit arbitrary service env.
# Read the fixed numeric PORT from the installed unit instead; fall back to the
# installer's default for older or hand-written units.
SERVICE_PORT="$(systemctl show -p Environment --value mso.service 2>/dev/null \
  | tr ' ' '\n' | sed -n 's/^PORT=//p' | head -1)"
PORT="${PORT:-${SERVICE_PORT:-4005}}"
HTML=""
for _ in $(seq 1 30); do
  HTML="$(curl -fsS --max-time 3 "http://127.0.0.1:$PORT/" 2>/dev/null || true)"
  [ -n "$HTML" ] && break
  sleep 1
done
CSS=$(printf '%s' "$HTML" | grep -o '/_next/static/[^"]*\.css' | head -1)
if [ -z "$CSS" ]; then
  die "no CSS reference in the served HTML — recover with: rm -rf .next && bun run build && sudo systemctl restart mso.service"
fi
TYPE=$(curl -fsSI --max-time 10 "http://127.0.0.1:$PORT$CSS" | tr -d '\r' | awk -F': ' 'tolower($1)=="content-type"{print $2}')
case "$TYPE" in
  text/css*) ;;
  *) die "chunk mismatch: $CSS served as '${TYPE:-nothing}'. Recover with: rm -rf .next && bun run build && sudo systemctl restart mso.service" ;;
esac

step "inner update stage complete — now at $(git rev-parse --short HEAD)"
printf 'INNER STAGE COMPLETE\n'
