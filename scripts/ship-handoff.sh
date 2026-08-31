#!/usr/bin/env bash
# Start final build/restart verification outside mso.service's cgroup.
#
# `exec_run` is served by mso.service. A normal child, nohup child included, remains
# in that service's cgroup and receives SIGTERM when MSO is replaced. The owner user
# manager is the existing safe boundary used by Settings self-update. The exact SHA
# and a clean checkout are required so the finalizer cannot build a moving tree.
set -euo pipefail

ROOT="${1:-}"
EXPECTED_SHA="${2:-}"
[ -n "$ROOT" ] && [ -n "$EXPECTED_SHA" ] \
  || { echo "usage: scripts/ship-handoff.sh <repo-root> <expected-full-sha>" >&2; exit 2; }
if [ "${#EXPECTED_SHA}" -ne 40 ]; then
  echo "expected SHA must be exactly 40 lowercase hex characters" >&2; exit 2
fi
case "$EXPECTED_SHA" in
  *[!0-9a-f]*) echo "expected SHA must be exactly 40 lowercase hex characters" >&2; exit 2 ;;
esac
ROOT="$(cd "$ROOT" && pwd -P)"
SERVICE_UPDATE="$ROOT/scripts/mso-service-update"
[ -f "$SERVICE_UPDATE" ] || { echo "missing $SERVICE_UPDATE" >&2; exit 2; }
[ "$(git -C "$ROOT" rev-parse --show-toplevel 2>/dev/null || true)" = "$ROOT" ] \
  || { echo "$ROOT is not the repository root" >&2; exit 2; }
[ "$(git -C "$ROOT" rev-parse HEAD)" = "$EXPECTED_SHA" ] \
  || { echo "checkout HEAD no longer matches the verified release SHA" >&2; exit 1; }
[ "$(git -C "$ROOT" rev-parse origin/main)" = "$EXPECTED_SHA" ] \
  || { echo "origin/main does not match the verified release SHA" >&2; exit 1; }
[ -z "$(git -C "$ROOT" status --porcelain)" ] \
  || { echo "checkout changed after verification; refusing to build uncommitted bytes" >&2; exit 1; }

UNIT="mso-self-update"
LOG="${MSO_UPDATE_LOG:-$HOME/.mso/self-update.log}"
mkdir -p "$(dirname "$LOG")"
chmod 700 "$(dirname "$LOG")" 2>/dev/null || true

if systemctl --user is-active --quiet "$UNIT.service"; then
  echo "$UNIT.service is already active; follow $LOG instead of starting a second finalizer" >&2
  exit 1
fi
systemctl --user reset-failed "$UNIT.service" >/dev/null 2>&1 || true

systemd-run \
  --user \
  --collect \
  "--unit=$UNIT" \
  "--property=WorkingDirectory=$ROOT" \
  "--property=TimeoutStartSec=3600" \
  "--setenv=MSO_UPDATE_LOG=$LOG" \
  "--setenv=MSO_EXPECTED_SHA=$EXPECTED_SHA" \
  /bin/bash "$SERVICE_UPDATE" --ship-finalize

printf 'release_sha=%s\n' "$EXPECTED_SHA"
printf 'release_unit=%s.service\n' "$UNIT"
printf 'release_log=%s\n' "$LOG"
printf 'release_status=systemctl --user is-active %s.service\n' "$UNIT"
