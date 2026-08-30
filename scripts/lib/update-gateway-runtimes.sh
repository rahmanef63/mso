#!/usr/bin/env bash
# Checkout-wide inventory of gateway-owned fallback runtimes around in-place builds.

update_gateway_restore_pending() {
  init_update_state
  if [ -e "$GATEWAY_RESTORE_FILE" ] || [ -L "$GATEWAY_RESTORE_FILE" ]; then
    mso_private_state_validate_file "$GATEWAY_RESTORE_FILE" >/dev/null || fail "unsafe gateway runtime restore inventory"
    jq -e 'type == "array" and all(.[]; type == "string" and length > 0)' "$GATEWAY_RESTORE_FILE" >/dev/null 2>&1 \
      || fail "invalid gateway runtime restore inventory"
    [ "$(jq 'length' "$GATEWAY_RESTORE_FILE")" -gt 0 ] && return 0
  fi
  restart_pending
}

update_gateway_restore_urls() {
  init_update_state
  if [ -e "$GATEWAY_RESTORE_FILE" ] || [ -L "$GATEWAY_RESTORE_FILE" ]; then
    mso_private_state_validate_file "$GATEWAY_RESTORE_FILE" >/dev/null || fail "unsafe gateway runtime restore inventory"
    jq -er 'if type == "array" and all(.[]; type == "string" and length > 0) then .[] else error("invalid") end' \
      "$GATEWAY_RESTORE_FILE" 2>/dev/null || fail "invalid gateway runtime restore inventory"
  elif restart_pending; then
    # Backward compatibility with the single-runtime marker used by older MSO.
    printf '%s\n' "${LOCAL_URL:-${MSO_GATEWAY_LOCAL_URL:-http://127.0.0.1:${MSO_PORT:-4005}}}"
  fi
}

update_gateway_owned_urls() {
  local base dir file state root owned url
  init_update_state
  base="$(mso_private_state_dir "${MSO_GATEWAY_STATE_BASE:-$HOME/.mso/private/gateway}")" \
    || fail "unsafe gateway state base"
  shopt -s nullglob
  for dir in "$base"/*; do
    [ -d "$dir" ] && [ ! -L "$dir" ] || continue
    file="$dir/state.json"
    [ -e "$file" ] || [ -L "$file" ] || continue
    mso_private_state_validate_file "$file" >/dev/null || fail "unsafe gateway state while preparing update"
    state="$(jq -ce . "$file" 2>/dev/null)" || fail "corrupt gateway state while preparing update"
    root="$(jq -er '.root | select(type=="string")' <<<"$state" 2>/dev/null || true)"
    [ "$root" = "$UPDATE_CANONICAL_ROOT" ] || continue
    owned="$(jq -r '.runtimeOwned // false' <<<"$state")"
    [ "$owned" = true ] || continue
    url="$(jq -er '.localUrl | select(type=="string" and length>0)' <<<"$state" 2>/dev/null || true)"
    [ -n "$url" ] || fail "gateway-owned runtime is missing its loopback origin"
    printf '%s\n' "$url"
  done
  shopt -u nullglob
}

update_gateway_collect_urls() {
  local restored owned
  restored="$(update_gateway_restore_urls)" || return 1
  owned="$(update_gateway_owned_urls)" || return 1
  printf '%s\n%s\n' "$restored" "$owned" | awk 'NF && !seen[$0]++'
}

update_gateway_write_restore_urls() {
  local payload
  payload="$(cat | jq -Rsc 'split("\n") | map(select(length > 0)) | unique')" || fail "could not encode gateway restore inventory"
  printf '%s\n' "$payload" | mso_private_state_atomic_write "$GATEWAY_RESTORE_FILE" >/dev/null \
    || fail "could not persist gateway restore inventory"
}

update_gateway_assert_offline_selected_origin_safe() {
  local selected
  selected="${LOCAL_URL:-${MSO_GATEWAY_LOCAL_URL:-http://127.0.0.1:${MSO_PORT:-4005}}}"
  MSO_GATEWAY_ROOT="$ROOT" MSO_GATEWAY_ENV="$ROOT/.env.local" MSO_GATEWAY_LOCAL_URL="$selected" \
    "$GATEWAY" runtime-assert-update-safe >/dev/null \
    || fail "selected loopback runtime is active but not safely update-owned; stop it before offline update"
}

update_gateway_quiesce_all() {
  local url out collected
  local -a urls=()
  init_update_state
  collected="$(update_gateway_collect_urls)" || fail "could not inventory checkout gateway runtimes"
  [ -n "$collected" ] || return 0
  mapfile -t urls <<<"$collected"
  printf '%s\n' "${urls[@]}" | update_gateway_write_restore_urls
  for url in "${urls[@]}"; do
    out="$(MSO_GATEWAY_ROOT="$ROOT" MSO_GATEWAY_ENV="$ROOT/.env.local" MSO_GATEWAY_LOCAL_URL="$url" \
      MSO_GATEWAY_RECOVERY_MARKER="$RESTART_MARKER" "$GATEWAY" runtime-stop)" \
      || fail "could not safely quiesce gateway runtime at $url"
    case "$out" in
      *'runtime: stopped-owned'*|*'runtime: recovered-stale-owned'*|*'runtime: recovery-pending'*|*'runtime: already-down'*) ;;
      *) fail "unexpected gateway runtime-stop result for $url" ;;
    esac
  done
}

update_gateway_restore_all() {
  local url restored
  local -a urls=()
  init_update_state
  restored="$(update_gateway_restore_urls)" || fail "could not read gateway runtime restore inventory"
  [ -n "$restored" ] || { clear_restart_pending; return 0; }
  mapfile -t urls <<<"$restored"
  for url in "${urls[@]}"; do
    MSO_GATEWAY_ROOT="$ROOT" MSO_GATEWAY_ENV="$ROOT/.env.local" MSO_GATEWAY_LOCAL_URL="$url" \
      "$GATEWAY" local-start >/dev/null || fail "updated build is healthy, but fallback runtime restore failed at $url"
  done
  clear_restart_pending
  mso_private_state_remove_file "$GATEWAY_RESTORE_FILE" >/dev/null 2>&1 || true
}
