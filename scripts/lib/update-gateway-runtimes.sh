#!/usr/bin/env bash
# Checkout-wide inventory of gateway-owned fallback runtimes around in-place builds.

update_gateway_restore_pending() {
  init_update_state
  if [ -e "$GATEWAY_RESTORE_FILE" ] || [ -L "$GATEWAY_RESTORE_FILE" ]; then
    mso_private_state_validate_file "$GATEWAY_RESTORE_FILE" >/dev/null || fail "unsafe gateway runtime restore inventory"
    jq -e '
      def envok: type=="object" and (.path|type=="string") and
        ((.path=="/dev/null" and .dev==null and .ino==null) or
         ((.path|startswith("/")) and .path!="/dev/null" and
          (.dev|type=="string" and test("^[0-9]+$")) and (.ino|type=="string" and test("^[0-9]+$"))));
      type=="array" and all(.[];
        (type=="string" and length>0) or
        (type=="object" and (.url|type=="string" and length>0) and ((.envFile==null) or (.envFile|envok))))
    ' "$GATEWAY_RESTORE_FILE" >/dev/null 2>&1 || fail "invalid gateway runtime restore inventory"
    [ "$(jq 'length' "$GATEWAY_RESTORE_FILE")" -gt 0 ] && return 0
  fi
  restart_pending
}

update_gateway_restore_entries() {
  init_update_state
  if [ -e "$GATEWAY_RESTORE_FILE" ] || [ -L "$GATEWAY_RESTORE_FILE" ]; then
    mso_private_state_validate_file "$GATEWAY_RESTORE_FILE" >/dev/null || fail "unsafe gateway runtime restore inventory"
    jq -cer '
      def envok: type=="object" and (.path|type=="string") and
        ((.path=="/dev/null" and .dev==null and .ino==null) or
         ((.path|startswith("/")) and .path!="/dev/null" and
          (.dev|type=="string" and test("^[0-9]+$")) and (.ino|type=="string" and test("^[0-9]+$"))));
      if type!="array" then error("invalid")
      elif all(.[]; type=="string" and length>0) then .[] | {url:.,envFile:null}
      elif all(.[]; type=="object" and (.url|type=="string" and length>0) and ((.envFile==null) or (.envFile|envok))) then .[]
      else error("invalid") end
    ' "$GATEWAY_RESTORE_FILE" 2>/dev/null || fail "invalid gateway runtime restore inventory"
  elif restart_pending; then
    # Backward compatibility with the old single-runtime marker. It predated env
    # identity, so only this legacy recovery path falls back to the checkout env.
    jq -nc --arg url "${LOCAL_URL:-${MSO_GATEWAY_LOCAL_URL:-http://127.0.0.1:${MSO_PORT:-4005}}}" '{url:$url,envFile:null}'
  fi
}

update_gateway_owned_entries() {
  local base dir file state root owned url env_file
  init_update_state
  base="$(mso_private_state_dir "${MSO_GATEWAY_STATE_BASE:-$HOME/.mso/private/gateway}")" || fail "unsafe gateway state base"
  shopt -s nullglob
  for dir in "$base"/*; do
    [ -d "$dir" ] && [ ! -L "$dir" ] || continue
    file="$dir/state.json"; [ -e "$file" ] || [ -L "$file" ] || continue
    mso_private_state_validate_file "$file" >/dev/null || fail "unsafe gateway state while preparing update"
    state="$(jq -ce . "$file" 2>/dev/null)" || fail "corrupt gateway state while preparing update"
    root="$(jq -er '.root | select(type=="string")' <<<"$state" 2>/dev/null || true)"
    [ "$root" = "$UPDATE_CANONICAL_ROOT" ] || continue
    owned="$(jq -r '.runtimeOwned // false' <<<"$state")"; [ "$owned" = true ] || continue
    url="$(jq -er '.localUrl | select(type=="string" and length>0)' <<<"$state" 2>/dev/null || true)"
    [ -n "$url" ] || fail "gateway-owned runtime is missing its loopback origin"
    env_file="$(jq -c '.envFile // null' <<<"$state")"
    [ "$env_file" != null ] || fail "gateway-owned runtime predates env identity; rerun mso web/gateway once with its original --env before updating"
    jq -e 'type=="object" and (.path|type=="string") and
      ((.path=="/dev/null" and .dev==null and .ino==null) or
       ((.path|startswith("/")) and .path!="/dev/null" and
        (.dev|type=="string" and test("^[0-9]+$")) and (.ino|type=="string" and test("^[0-9]+$"))))' \
      <<<"$env_file" >/dev/null 2>&1 || fail "gateway-owned runtime has invalid env identity"
    jq -nc --arg url "$url" --argjson envFile "$env_file" '{url:$url,envFile:$envFile}'
  done
  shopt -u nullglob
}

update_gateway_collect_entries() {
  local restored owned
  restored="$(update_gateway_restore_entries)" || return 1
  owned="$(update_gateway_owned_entries)" || return 1
  printf '%s\n%s\n' "$restored" "$owned" | awk 'NF' | jq -cs 'unique_by(.url)[]'
}

update_gateway_write_restore_entries() {
  local payload
  payload="$(jq -cs 'unique_by(.url)')" || fail "could not encode gateway restore inventory"
  printf '%s\n' "$payload" | mso_private_state_atomic_write "$GATEWAY_RESTORE_FILE" >/dev/null \
    || fail "could not persist gateway restore inventory"
}

update_gateway_entry_call() {
  local action="$1" entry="$2" url env_file env_path
  url="$(jq -er '.url' <<<"$entry")" || return 1
  env_file="$(jq -c '.envFile // null' <<<"$entry")"
  if [ "$env_file" = null ]; then
    MSO_GATEWAY_ROOT="$ROOT" MSO_GATEWAY_ENV="$ROOT/.env.local" MSO_GATEWAY_LOCAL_URL="$url" \
      MSO_GATEWAY_RECOVERY_MARKER="${RESTART_MARKER:-}" "$GATEWAY" "$action"
    return
  fi
  env_path="$(jq -er '.path' <<<"$env_file")" || return 1
  MSO_GATEWAY_ROOT="$ROOT" MSO_GATEWAY_ENV="$env_path" MSO_GATEWAY_LOCAL_URL="$url" \
    MSO_GATEWAY_EXPECT_ENV_IDENTITY="$env_file" MSO_GATEWAY_RECOVERY_MARKER="${RESTART_MARKER:-}" \
    "$GATEWAY" "$action"
}

update_gateway_assert_offline_selected_origin_safe() {
  local selected
  selected="${LOCAL_URL:-${MSO_GATEWAY_LOCAL_URL:-http://127.0.0.1:${MSO_PORT:-4005}}}"
  MSO_GATEWAY_ROOT="$ROOT" MSO_GATEWAY_ENV="$ROOT/.env.local" MSO_GATEWAY_LOCAL_URL="$selected" \
    "$GATEWAY" runtime-assert-update-safe >/dev/null \
    || fail "selected loopback runtime is active but not safely update-owned; stop it before offline update"
}

update_gateway_quiesce_all() {
  local entry out collected
  local -a entries=()
  init_update_state
  collected="$(update_gateway_collect_entries)" || fail "could not inventory checkout gateway runtimes"
  [ -n "$collected" ] || return 0
  mapfile -t entries <<<"$collected"
  printf '%s\n' "${entries[@]}" | update_gateway_write_restore_entries
  for entry in "${entries[@]}"; do
    out="$(update_gateway_entry_call runtime-stop "$entry")" || fail "could not safely quiesce gateway runtime at $(jq -r .url <<<"$entry")"
    case "$out" in
      *'runtime: stopped-owned'*|*'runtime: recovered-stale-owned'*|*'runtime: recovery-pending'*|*'runtime: already-down'*) ;;
      *) fail "unexpected gateway runtime-stop result for $(jq -r .url <<<"$entry")" ;;
    esac
  done
}

update_gateway_restore_all() {
  local entry restored
  local -a entries=()
  init_update_state
  restored="$(update_gateway_restore_entries)" || fail "could not read gateway runtime restore inventory"
  [ -n "$restored" ] || { clear_restart_pending; return 0; }
  mapfile -t entries <<<"$restored"
  for entry in "${entries[@]}"; do
    update_gateway_entry_call local-start "$entry" >/dev/null \
      || fail "updated build is healthy, but fallback runtime restore failed at $(jq -r .url <<<"$entry")"
  done
  clear_restart_pending
  mso_private_state_remove_file "$GATEWAY_RESTORE_FILE" >/dev/null 2>&1 || true
}
