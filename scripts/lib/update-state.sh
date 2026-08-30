#!/usr/bin/env bash
# Checkout-scoped private deployment state + exclusive offline-update transaction lock.

UPDATE_STATE_DIR=''
UPDATE_CANONICAL_ROOT=''
DEPLOY_RECEIPT=''
RESTART_MARKER=''
UPDATE_LOCK_DIR=''
UPDATE_LOCK_HELD=0

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

update_lock_owner_valid() {
  local owner="$UPDATE_LOCK_DIR/owner" pid ticks live
  [ -f "$owner" ] && [ ! -L "$owner" ] || return 1
  read -r pid ticks <"$owner" || return 1
  [[ "$pid" =~ ^[0-9]+$ && "$ticks" =~ ^[0-9]+$ ]] || return 1
  live="$(update_proc_start_ticks "$pid" 2>/dev/null || true)"
  [ -n "$live" ] && [ "$live" = "$ticks" ]
}

update_lock_acquire() {
  local self_ticks candidate stale i
  init_update_state
  self_ticks="$(update_proc_start_ticks $$)" || fail "cannot identify update process"
  for i in $(seq 1 1200); do
    candidate="$UPDATE_STATE_DIR/.transaction-lock.$$.$RANDOM"
    if ! mkdir -m 700 -- "$candidate" 2>/dev/null; then sleep 0.01; continue; fi
    printf '%s %s\n' "$$" "$self_ticks" >"$candidate/owner"; chmod 600 "$candidate/owner"
    if mv -T -- "$candidate" "$UPDATE_LOCK_DIR" 2>/dev/null; then UPDATE_LOCK_HELD=1; return 0; fi
    rm -rf -- "$candidate"
    if [ -d "$UPDATE_LOCK_DIR" ] && [ ! -L "$UPDATE_LOCK_DIR" ] && ! update_lock_owner_valid; then
      stale="$UPDATE_STATE_DIR/.transaction-stale.$$.$RANDOM"
      mv -T -- "$UPDATE_LOCK_DIR" "$stale" 2>/dev/null && rm -rf -- "$stale" || true
    fi
    sleep 0.05
  done
  fail "another offline update transaction is still running"
}

update_lock_release() {
  [ "$UPDATE_LOCK_HELD" = 1 ] || return 0
  if update_lock_owner_valid; then rm -f -- "$UPDATE_LOCK_DIR/owner"; rmdir -- "$UPDATE_LOCK_DIR" 2>/dev/null || true; fi
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
