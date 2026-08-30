#!/usr/bin/env bash
# Checkout-scoped private deployment state + exclusive offline-update transaction lock.

UPDATE_STATE_DIR=''
UPDATE_CANONICAL_ROOT=''
DEPLOY_RECEIPT=''
RESTART_MARKER=''
UPDATE_LOCK_DIR=''
UPDATE_LOCK_HELD=0
UPDATE_LOCK_FD=''

update_proc_start_ticks() {
  local pid="$1" line rest
  [ "$pid" -gt 1 ] 2>/dev/null && kill -0 "$pid" 2>/dev/null || return 1
  IFS= read -r line <"/proc/$pid/stat" || return 1
  rest="${line##*) }"; set -- $rest
  [ "$#" -ge 20 ] || return 1
  printf '%s' "${20}"
}

init_update_state() {
  local base key
  [ -n "$UPDATE_STATE_DIR" ] && return 0
  UPDATE_CANONICAL_ROOT="$(realpath -e -- "$ROOT" 2>/dev/null || true)"
  [ -n "$UPDATE_CANONICAL_ROOT" ] || fail "cannot canonicalize update checkout: $ROOT"
  base="$(mso_private_state_dir "$UPDATE_STATE_DIR_REQUESTED")" || fail "unsafe update state directory"
  key="$(printf '%s' "$UPDATE_CANONICAL_ROOT" | sha256sum | awk '{print $1}')"
  [[ "$key" =~ ^[0-9a-f]{64}$ ]] || fail "cannot derive checkout-scoped update state key"
  UPDATE_STATE_DIR="$(mso_private_state_dir "$base/$key")" || fail "unsafe checkout-scoped update state directory"
  DEPLOY_RECEIPT="$UPDATE_STATE_DIR/deployed.json"
  RESTART_MARKER="$UPDATE_STATE_DIR/restart-runtime"
  UPDATE_LOCK_DIR="$UPDATE_STATE_DIR/transaction.lock"
}

read_receipt() {
  local root sha
  init_update_state
  if [ ! -e "$DEPLOY_RECEIPT" ] && [ ! -L "$DEPLOY_RECEIPT" ]; then return 1; fi
  mso_private_state_validate_file "$DEPLOY_RECEIPT" >/dev/null || fail "unsafe deployment receipt"
  root="$(jq -er '.root | select(type=="string")' "$DEPLOY_RECEIPT" 2>/dev/null || true)"
  sha="$(jq -er '.sha | select(type=="string")' "$DEPLOY_RECEIPT" 2>/dev/null || true)"
  [ "$root" = "$UPDATE_CANONICAL_ROOT" ] || fail "deployment receipt belongs to another checkout"
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || fail "invalid deployment receipt sha"
  printf '%s' "$sha"
}

write_receipt() {
  local sha
  init_update_state
  sha="$(git -C "$ROOT" rev-parse HEAD)"
  jq -nc --arg root "$UPDATE_CANONICAL_ROOT" --arg sha "$sha" '{root:$root,sha:$sha}' \
    | mso_private_state_atomic_write "$DEPLOY_RECEIPT" >/dev/null
}

restart_pending() {
  init_update_state
  if [ ! -e "$RESTART_MARKER" ] && [ ! -L "$RESTART_MARKER" ]; then return 1; fi
  mso_private_state_validate_file "$RESTART_MARKER" >/dev/null || fail "unsafe runtime restart marker"
  [ "$(cat "$RESTART_MARKER")" = 1 ] || fail "invalid runtime restart marker"
}

clear_restart_pending() {
  init_update_state
  mso_private_state_remove_file "$RESTART_MARKER" >/dev/null 2>&1 || true
}

update_lock_acquire() {
  init_update_state
  mso_private_state_ensure_file "$UPDATE_LOCK_DIR" >/dev/null || fail "unsafe offline update transaction lock"
  exec {UPDATE_LOCK_FD}<>"$UPDATE_LOCK_DIR" || fail "cannot open offline update transaction lock"
  if ! flock -x -w 900 "$UPDATE_LOCK_FD"; then
    exec {UPDATE_LOCK_FD}>&- || true
    UPDATE_LOCK_FD=''
    fail "another offline update transaction is still running"
  fi
  UPDATE_LOCK_HELD=1
}

update_lock_release() {
  [ "$UPDATE_LOCK_HELD" = 1 ] || return 0
  if [ -n "${UPDATE_LOCK_FD:-}" ]; then
    flock -u "$UPDATE_LOCK_FD" 2>/dev/null || true
    exec {UPDATE_LOCK_FD}>&- || true
    UPDATE_LOCK_FD=''
  fi
  UPDATE_LOCK_HELD=0
}

update_with_lock() {
  update_lock_acquire
  trap update_lock_release EXIT
  trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM
  "$@"
  update_lock_release
  trap - EXIT HUP INT TERM
}
