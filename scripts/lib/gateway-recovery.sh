#!/usr/bin/env bash
# Durable update-recovery intent shared only by the internal runtime-stop path.

gateway_recovery_marker_path() {
  local requested="${MSO_GATEWAY_RECOVERY_MARKER:-}"
  [ -n "$requested" ] || gateway_fail "runtime-stop requires an update recovery marker"
  case "$requested" in /*) ;; *) gateway_fail "update recovery marker must be an absolute path" ;; esac
  mso_private_state_path "$requested" || gateway_fail "unsafe update recovery marker path"
}

gateway_recovery_pending() {
  local marker
  marker="$(gateway_recovery_marker_path)"
  if [ ! -e "$marker" ] && [ ! -L "$marker" ]; then return 1; fi
  mso_private_state_validate_file "$marker" >/dev/null || gateway_fail "unsafe update recovery marker"
  [ "$(cat "$marker")" = 1 ] || gateway_fail "invalid update recovery marker"
}

gateway_mark_recovery_pending() {
  local marker
  marker="$(gateway_recovery_marker_path)"
  printf '1\n' | mso_private_state_atomic_write "$marker" >/dev/null \
    || gateway_fail "could not persist runtime recovery intent; runtime was NOT stopped"
  gateway_recovery_pending || gateway_fail "runtime recovery intent did not persist"
}

gateway_runtime_process_matches() {
  gateway_identity_matches_retry "$1"
}

gateway_runtime_identity_matches() {
  local identity="$1" instance
  instance="$(jq -r '.instanceId // empty' <<<"$identity" 2>/dev/null || true)"
  [ -n "$instance" ] && gateway_runtime_process_matches "$identity" \
    && gateway_health_url_ok "$LOCAL_URL" "$instance"
}

gateway_wait_runtime_stopped() {
  local identity="$1" i
  for i in $(seq 1 40); do
    gateway_runtime_process_matches "$identity" || return 0
    sleep 0.05
  done
  return 1
}
