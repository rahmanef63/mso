#!/usr/bin/env bash
# Persist connector replacement intent so retries can retire a leftover owned child.

gateway_app_route_record_read() {
  local file="$STATE_ROOT/app-route-reload.json"
  if [ ! -e "$file" ] && [ ! -L "$file" ]; then printf '{}\n'; return 0; fi
  mso_private_state_validate_file "$file" >/dev/null || gateway_fail "unsafe managed app route reload state"
  jq -ce 'select(type=="object")' "$file" || gateway_fail "invalid managed app route reload state"
}

gateway_app_route_record() {
  local result="$1" previous="$2" current="$3" phase="$4"
  jq -nc --arg root "$GATEWAY_CANONICAL_ROOT" --arg scope "$GATEWAY_SCOPE_ID" --arg config "$GATEWAY_CONFIG" --arg tunnel "$GATEWAY_APP_TUNNEL_ID" \
    --arg phase "$phase" --argjson result "$result" --argjson previous "$previous" --argjson current "$current" \
    '{root:$root,scopeId:$scope,configPath:$config,tunnelId:$tunnel,phase:$phase,configSha256:$result.configSha256,previousIdentity:$previous,tunnelIdentity:$current}' \
    | mso_private_state_atomic_write "$STATE_ROOT/app-route-reload.json" >/dev/null
}

gateway_app_route_record_matches() {
  jq -e --arg root "$GATEWAY_CANONICAL_ROOT" --arg scope "$GATEWAY_SCOPE_ID" --arg config "$GATEWAY_CONFIG" --arg tunnel "$GATEWAY_APP_TUNNEL_ID" \
    '.root==$root and .scopeId==$scope and .configPath==$config and .tunnelId==$tunnel' <<<"$1" >/dev/null
}

gateway_app_route_restore_previous() {
  local state record current previous inspection
  state="$(gateway_state_read)" || gateway_fail "cannot read gateway recovery state"
  current="$(jq -c '.tunnelIdentity // null' <<<"$state")"
  [ "$current" != null ] || return 0
  gateway_identity_matches_retry "$current" && return 0
  record="$(gateway_app_route_record_read)"
  [ "$(jq -r '.phase // empty' <<<"$record")" = pending ] || return 0
  jq -e --argjson current "$current" '.tunnelIdentity==$current and .previousIdentity!=null' <<<"$record" >/dev/null \
    || gateway_fail "pending reload does not prove a prior connector for this interrupted state"
  gateway_app_route_expected_context "$state" ensure
  previous="$(jq -c .previousIdentity <<<"$record")"
  gateway_app_route_owned_recipe "$previous"
  gateway_app_route_record_matches "$record" || gateway_fail "pending reload belongs to another gateway or config"
  inspection="$(gateway_app_route_config inspect)" || return 1
  [ "$(jq -r .configSha256 <<<"$inspection")" = "$(jq -r .configSha256 <<<"$record")" ] \
    || gateway_fail "named config changed after the interrupted reload"
  gateway_identity_matches "$previous" || gateway_fail "prior connector changed before recovery"
  # Change only the connector pointer. Runtime identity, env provenance, and all
  # other durable fields remain exactly as recorded by the interrupted swap.
  jq -c --argjson previous "$previous" '.tunnelIdentity=$previous' <<<"$state" \
    | mso_private_state_atomic_write "$STATE_FILE" >/dev/null \
    || gateway_fail "could not restore the proven prior connector state"
}

gateway_app_route_loaded() {
  local record current
  record="$(gateway_app_route_record_read)"
  gateway_app_route_record_matches "$record" || return 1
  current="$(jq -c .tunnelIdentity <<<"$GATEWAY_APP_STATE")"
  jq -e --argjson result "$1" --argjson current "$current" \
    '.phase=="ready" and .configSha256==$result.configSha256 and .tunnelIdentity==$current' <<<"$record" >/dev/null
}

gateway_app_route_recover_pending() {
  local record current previous replacement
  record="$(gateway_app_route_record_read)"
  gateway_app_route_record_matches "$record" || return 0
  [ "$(jq -r '.phase // empty' <<<"$record")" = pending ] || return 0
  current="$(jq -c .tunnelIdentity <<<"$GATEWAY_APP_STATE")"
  previous="$(jq -c '.previousIdentity // null' <<<"$record")"
  replacement="$(jq -c '.tunnelIdentity // null' <<<"$record")"
  if [ "$(jq -cS . <<<"$current")" = "$(jq -cS . <<<"$replacement")" ]; then
    [ "$previous" = null ] || gateway_stop_identity "$previous" || gateway_fail "previous owned connector is still running"
  elif [ "$(jq -cS . <<<"$current")" = "$(jq -cS . <<<"$previous")" ]; then
    [ "$replacement" = null ] || gateway_stop_identity "$replacement" || gateway_fail "uncommitted owned connector is still running"
  else
    gateway_fail "managed app route reload state does not match the active connector"
  fi
}

gateway_app_route_wait_connected() {
  local seconds="${MSO_GATEWAY_PUBLIC_READY_SECONDS:-30}" deadline
  [[ "$seconds" =~ ^[0-9]+$ ]] && [ "$seconds" -ge 10 ] && [ "$seconds" -le 120 ] \
    || gateway_fail "MSO_GATEWAY_PUBLIC_READY_SECONDS must be an integer from 10 to 120"
  deadline=$((SECONDS+seconds))
  while [ "$SECONDS" -lt "$deadline" ]; do
    gateway_identity_matches "$TUNNEL_IDENTITY" || return 1
    grep -q 'Registered tunnel connection' "$PROVIDER_LOG" && return 0
    sleep 0.2
  done
  return 1
}

gateway_app_route_reload() {
  local result="$1" previous replacement hash published_log="$PROVIDER_LOG"
  previous="$(jq -c .tunnelIdentity <<<"$GATEWAY_APP_STATE")"
  hash="$(sha256sum -- "$GATEWAY_CONFIG" | awk '{print $1}')"
  [ "$hash" = "$(jq -r .configSha256 <<<"$result")" ] || gateway_fail "named config changed before connector reload"
  gateway_identity_matches "$previous" || gateway_fail "owned connector changed before reload"
  # A fresh private inode ensures readiness cannot come from the old connector's
  # still-open log descriptor. MSO's runtime and the old connector remain live.
  PROVIDER_LOG="$(mktemp "$STATE_ROOT/.app-route-provider.XXXXXX.log")" \
    || gateway_fail "cannot create a private replacement connector log"
  gateway_private_file "$PROVIDER_LOG"
  TUNNEL_IDENTITY=null; RUNTIME_STARTED_NOW=false
  gateway_spawn_tunnel || gateway_fail "replacement connector did not start; existing connector remains active"
  gateway_app_route_wait_connected || gateway_fail "replacement connector did not register a tunnel connection; previous connector remains active"
  gateway_probe_public || gateway_fail "replacement connector could not verify the public MSO route"
  gateway_refresh_tunnel_identity || gateway_fail "replacement connector lost its captured identity"
  replacement="$TUNNEL_IDENTITY"
  gateway_app_route_record "$result" "$previous" "$replacement" pending \
    || gateway_fail "cannot persist connector replacement intent; existing connector remains active"
  # The durable pending record owns cleanup from this point, including a crash
  # before the state swap. EXIT must not kill an already-persisted replacement.
  GATEWAY_PENDING_CLEANUP=0; TUNNEL_PENDING_PID=0; TUNNEL_PENDING_TICKS=''
  if ! gateway_write_state cloudflare-named named "$GATEWAY_PUBLIC_URL" "$replacement"; then
    gateway_stop_identity "$replacement" || true
    gateway_fail "cannot persist replacement connector state; previous connector was retained"
  fi
  gateway_identity_matches "$replacement" || gateway_fail "replacement connector stopped; previous connector was retained for recovery"
  gateway_stop_identity "$previous" || gateway_fail "previous connector is still running; reload can be retried"
  gateway_probe_public && gateway_identity_matches "$replacement" \
    || gateway_fail "replacement connector is not healthy; route config and pending reload were preserved for retry"
  gateway_app_route_record "$result" null "$replacement" ready \
    || gateway_fail "connector is healthy but its route receipt could not be saved; retry is safe"
  gateway_private_file "$published_log"
  mv -fT -- "$PROVIDER_LOG" "$published_log"
  PROVIDER_LOG="$published_log"
  GATEWAY_APP_STATE="$(gateway_state_read)"
}
