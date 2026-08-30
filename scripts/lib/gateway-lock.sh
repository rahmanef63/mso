#!/usr/bin/env bash
# Owner-only lifecycle lock and signal-safe pending-child cleanup.

gateway_lock_owner_valid() {
  local owner="$LOCK_DIR/owner" pid ticks live
  [ -f "$owner" ] && [ ! -L "$owner" ] || return 1
  read -r pid ticks <"$owner" || return 1
  [[ "$pid" =~ ^[0-9]+$ && "$ticks" =~ ^[0-9]+$ ]] || return 1
  live="$(gateway_proc_start_ticks "$pid" 2>/dev/null || true)"
  [ -n "$live" ] && [ "$live" = "$ticks" ]
}

gateway_lock_acquire() {
  local self_ticks candidate stale i
  self_ticks="$(gateway_proc_start_ticks $$)" || gateway_fail "cannot identify gateway process"
  for i in $(seq 1 240); do
    candidate="$STATE_ROOT/.lifecycle-lock.$$.$RANDOM"
    mkdir -m 700 -- "$candidate"
    printf '%s %s\n' "$$" "$self_ticks" >"$candidate/owner"; chmod 600 "$candidate/owner"
    if mv -T -- "$candidate" "$LOCK_DIR" 2>/dev/null; then LOCK_HELD=1; return 0; fi
    rm -rf -- "$candidate"
    if [ -d "$LOCK_DIR" ] && [ ! -L "$LOCK_DIR" ] && ! gateway_lock_owner_valid; then
      stale="$STATE_ROOT/.lifecycle-stale.$$.$RANDOM"
      mv -T -- "$LOCK_DIR" "$stale" 2>/dev/null && rm -rf -- "$stale" || true
    fi
    sleep 0.05
  done
  gateway_fail "another gateway lifecycle operation is still running"
}

gateway_lock_release() {
  [ "${LOCK_HELD:-0}" = 1 ] || return 0
  if gateway_lock_owner_valid; then rm -f -- "$LOCK_DIR/owner"; rmdir -- "$LOCK_DIR" 2>/dev/null || true; fi
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
