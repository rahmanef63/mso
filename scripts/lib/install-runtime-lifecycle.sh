#!/usr/bin/env bash
# Installer-side checkout lifecycle around dependency + in-place Next build work.
# Expected globals/functions: DIR, PORT, DO_SERVICE, SERVICE, die, sudo_do,
# systemd_ready. The installer keeps this lifecycle open through service refresh.

INSTALL_RUNTIME_LIFECYCLE=0
INSTALL_RUNTIME_SERVICE_STOPPED=0

install_runtime_lifecycle_init() {
  ROOT="$DIR"
  UPDATE_STATE_DIR_REQUESTED="${MSO_UPDATE_STATE_DIR:-$HOME/.mso/private/update-state}"
  LOCAL_URL="${MSO_GATEWAY_LOCAL_URL:-http://127.0.0.1:${PORT:-4005}}"
  GATEWAY="$ROOT/scripts/mso-gateway"
  fail() { die "$@"; }

  # shellcheck source=scripts/lib/private-state.sh
  . "$ROOT/scripts/lib/private-state.sh"
  # shellcheck source=scripts/lib/update-state.sh
  . "$ROOT/scripts/lib/update-state.sh"
  # shellcheck source=scripts/lib/runtime-exclusion.sh
  . "$ROOT/scripts/lib/runtime-exclusion.sh"
  # shellcheck source=scripts/lib/update-gateway-runtimes.sh
  . "$ROOT/scripts/lib/update-gateway-runtimes.sh"
}

install_runtime_lifecycle_cleanup() {
  [ "$INSTALL_RUNTIME_LIFECYCLE" = 1 ] || return 0
  runtime_exclusion_release >/dev/null 2>&1 || true
  update_lock_release >/dev/null 2>&1 || true
}

install_runtime_active_service_preflight() {
  local configured canonical_service
  systemd_ready || return 0
  systemctl is-active --quiet "$SERVICE" || return 0
  configured="$(systemctl show -p WorkingDirectory --value "$SERVICE" 2>/dev/null || true)"
  [ -n "$configured" ] || die "$SERVICE is active but its WorkingDirectory is unreadable; refusing in-place installer build"
  canonical_service="$(realpath -e -- "$configured" 2>/dev/null || true)"
  [ -n "$canonical_service" ] || die "cannot canonicalize active $SERVICE WorkingDirectory"
  [ "$canonical_service" = "$UPDATE_CANONICAL_ROOT" ] \
    || die "$SERVICE belongs to $canonical_service, not installer checkout $UPDATE_CANONICAL_ROOT; stop it or rerun against that checkout"
  [ "$DO_SERVICE" -eq 1 ] \
    || die "$SERVICE is active on this checkout; --no-service cannot rebuild its live .next tree"
  INSTALL_RUNTIME_SERVICE_STOPPED=1
}

install_runtime_lifecycle_begin() {
  install_runtime_lifecycle_init
  update_lock_acquire
  INSTALL_RUNTIME_LIFECYCLE=1
  runtime_exclusion_acquire_exclusive \
    || die "could not acquire checkout runtime exclusion before installer build"

  # Validate pending + owned gateway inventory before stopping a system service.
  # A legacy owned runtime with no env identity fails here while everything is live.
  update_gateway_collect_entries >/dev/null \
    || die "could not validate gateway runtime inventory before installer build"
  install_runtime_active_service_preflight
  if [ "$INSTALL_RUNTIME_SERVICE_STOPPED" = 1 ]; then
    sudo_do systemctl stop "$SERVICE" || die "could not quiesce $SERVICE before installer build"
  fi

  # After any owned service is down, no unowned selected loopback runtime may still
  # be serving the tree. Then persist restore intent before stopping fallbacks.
  update_gateway_assert_offline_selected_origin_safe
  update_gateway_quiesce_all
}

install_runtime_lifecycle_finish() {
  [ "$INSTALL_RUNTIME_LIFECYCLE" = 1 ] || return 0
  runtime_exclusion_release
  update_gateway_restore_all
  update_lock_release
  INSTALL_RUNTIME_LIFECYCLE=0
  INSTALL_RUNTIME_SERVICE_STOPPED=0
}
