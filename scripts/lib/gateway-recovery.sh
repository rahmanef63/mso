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

RUNTIME_PENDING_PID=0
RUNTIME_PENDING_TICKS=''
RUNTIME_PENDING_GATE=''

gateway_track_pending_runtime() {
  local pid="$1" ticks i
  RUNTIME_PENDING_PID="$pid"; RUNTIME_PENDING_TICKS=''
  for i in $(seq 1 20); do
    ticks="$(gateway_proc_start_ticks "$pid" 2>/dev/null || true)"
    [ -n "$ticks" ] && { RUNTIME_PENDING_TICKS="$ticks"; GATEWAY_PENDING_CLEANUP=1; return 0; }
    gateway_pid_alive "$pid" || return 1
    sleep 0.01
  done
  return 1
}

gateway_runtime_pending_gate_cleanup() {
  local gate="${RUNTIME_PENDING_GATE:-}"
  [ -n "$gate" ] || return 0
  if [ -e "$gate" ] || [ -L "$gate" ]; then mso_private_state_remove_file "$gate" >/dev/null 2>&1 || true; fi
  RUNTIME_PENDING_GATE=''
}

gateway_stop_pending_runtime() {
  local pid="${RUNTIME_PENDING_PID:-0}" ticks="${RUNTIME_PENDING_TICKS:-}" live i
  gateway_runtime_pending_gate_cleanup
  [ "$pid" -gt 1 ] 2>/dev/null && [ -n "$ticks" ] || return 0
  live="$(gateway_proc_start_ticks "$pid" 2>/dev/null || true)"
  [ "$live" = "$ticks" ] || { RUNTIME_PENDING_PID=0; RUNTIME_PENDING_TICKS=''; return 0; }
  kill "$pid" 2>/dev/null || true
  for i in $(seq 1 25); do
    live="$(gateway_proc_start_ticks "$pid" 2>/dev/null || true)"
    [ "$live" != "$ticks" ] && break
    sleep 0.04
  done
  live="$(gateway_proc_start_ticks "$pid" 2>/dev/null || true)"
  [ "$live" != "$ticks" ] || kill -KILL "$pid" 2>/dev/null || true
  RUNTIME_PENDING_PID=0; RUNTIME_PENDING_TICKS=''
}
