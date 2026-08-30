#!/usr/bin/env bash
# Owner-only lifecycle lock and signal-safe pending-child cleanup.

gateway_lock_acquire() {
  gateway_private_file "$LOCK_FILE"
  exec {GATEWAY_LOCK_FD}<>"$LOCK_FILE" || gateway_fail "cannot open gateway lifecycle lock"
  if ! flock -x -w 12 "$GATEWAY_LOCK_FD"; then
    exec {GATEWAY_LOCK_FD}>&- || true
    GATEWAY_LOCK_FD=''
    gateway_fail "another gateway lifecycle operation is still running"
  fi
  LOCK_HELD=1
}

gateway_lock_release() {
  [ "${LOCK_HELD:-0}" = 1 ] || return 0
  if [ -n "${GATEWAY_LOCK_FD:-}" ]; then
    flock -u "$GATEWAY_LOCK_FD" 2>/dev/null || true
    exec {GATEWAY_LOCK_FD}>&- || true
    GATEWAY_LOCK_FD=''
  fi
  LOCK_HELD=0
}

GATEWAY_PENDING_CLEANUP=0

gateway_operation_cleanup() {
  [ "${GATEWAY_PENDING_CLEANUP:-0}" = 1 ] || return 0
  if declare -F gateway_cleanup_failed_start >/dev/null 2>&1; then
    gateway_cleanup_failed_start || true
  fi
  GATEWAY_PENDING_CLEANUP=0
}

gateway_with_lock() {
  gateway_lock_acquire
  # HUP/INT/TERM become ordinary non-zero exits. EXIT then rolls back any
  # pre-persistence child processes before releasing the lifecycle lock.
  trap 'gateway_operation_cleanup; gateway_lock_release' EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
  "$@"
  gateway_operation_cleanup
  gateway_lock_release
  trap - EXIT HUP INT TERM
}
