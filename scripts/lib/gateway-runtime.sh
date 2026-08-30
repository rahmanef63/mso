#!/usr/bin/env bash
# Runtime/state lifecycle used by the public tunnel and local `mso web` fallback.

GATEWAY_EXPECTED_VERSION="$(node -p "require('$ROOT/package.json').version")" || gateway_fail "cannot read MSO version"

gateway_runtime_from_state() {
  local state="$1" identity owned instance
  RUNTIME_IDENTITY='null'; RUNTIME_INSTANCE_ID=''; RUNTIME_OWNED=false; RUNTIME_STARTED_NOW=false
  owned="$(jq -r '.runtimeOwned // false' <<<"$state")"
  identity="$(jq -c '.runtimeIdentity // null' <<<"$state")"
  instance="$(jq -r '.runtimeIdentity.instanceId // empty' <<<"$state")"
  if [ "$owned" = true ] && [ "$identity" != null ] && [ -n "$instance" ]       && gateway_identity_matches_retry "$identity" && gateway_health_url_ok "$LOCAL_URL" "$instance"; then
    RUNTIME_IDENTITY="$identity"; RUNTIME_INSTANCE_ID="$instance"; RUNTIME_OWNED=true
  fi
}

gateway_start_runtime_if_needed() {
  local next host port pid identity instance node_exe current_exe i
  [ "$RUNTIME_OWNED" = true ] && gateway_health_url_ok "$LOCAL_URL" "$RUNTIME_INSTANCE_ID" && return 0
  if gateway_health_ok; then
    RUNTIME_IDENTITY='null'; RUNTIME_INSTANCE_ID=''; RUNTIME_OWNED=false; RUNTIME_STARTED_NOW=false
    return 0
  fi

  next="$ROOT/node_modules/next/dist/bin/next"
  [ -f "$next" ] || gateway_fail "MSO runtime is down and Next is missing; run: mso update"
  [ -f "$ROOT/.next/BUILD_ID" ] || gateway_fail "MSO runtime is down and no production build exists; run: mso update"
  IFS=$'\t' read -r host port < <(gateway_loopback_host_port)
  [ "$host" = "127.0.0.1" ] || [ "$host" = "localhost" ] \
    || gateway_fail "detached fallback supports 127.0.0.1/localhost; start MSO manually for $host"
  [[ "$port" =~ ^[0-9]{1,5}$ ]] || gateway_fail "invalid local port: $port"

  instance="$(node -e 'process.stdout.write(require("crypto").randomBytes(16).toString("hex"))')"
  node_exe="$(readlink -f -- "$(command -v node)")"
  gateway_private_file "$RUNTIME_LOG"; : >"$RUNTIME_LOG"
  (
    cd "$ROOT" || exit 1
    nohup env MSO_RUNTIME_INSTANCE_ID="$instance" node "$next" start --hostname 127.0.0.1 --port "$port" >>"$RUNTIME_LOG" 2>&1 &
    printf '%s\n' "$!"
  ) >"$STATE_ROOT/.runtime-pid.$$"
  pid="$(cat "$STATE_ROOT/.runtime-pid.$$")"; rm -f "$STATE_ROOT/.runtime-pid.$$"
  identity=''
  for i in $(seq 1 30); do
    if gateway_pid_alive "$pid"; then
      current_exe="$(readlink -f -- "/proc/$pid/exe" 2>/dev/null || true)"
      if [ "$current_exe" = "$node_exe" ]; then
        identity="$(gateway_capture_identity "$pid" 2>/dev/null || true)"
        [ -n "$identity" ] && break
      fi
    else break; fi
    sleep 0.05
  done
  if [ -z "$identity" ]; then kill "$pid" 2>/dev/null || true; gateway_fail "runtime did not start as the expected Node process"; fi
  identity="$(jq -c --arg instance "$instance" '.cmdHash=null | .instanceId=$instance' <<<"$identity")"
  if ! gateway_wait_health "$instance"; then
    gateway_stop_identity "$identity"
    gateway_fail "runtime did not become this launch's MSO health instance; see $RUNTIME_LOG"
  fi
  RUNTIME_IDENTITY="$identity"; RUNTIME_INSTANCE_ID="$instance"; RUNTIME_OWNED=true; RUNTIME_STARTED_NOW=true
}

gateway_write_state() {
  local provider="$1" mode="$2" url="$3" tunnel_identity="$4"
  jq -nc --arg provider "$provider" --arg mode "$mode" --arg url "$url" --arg local "$LOCAL_URL" \
    --argjson tunnelIdentity "$tunnel_identity" --argjson runtimeIdentity "$RUNTIME_IDENTITY" \
    --argjson runtimeOwned "$RUNTIME_OWNED" --arg startedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{provider:$provider,mode:$mode,url:$url,localUrl:$local,tunnelIdentity:$tunnelIdentity,
      runtimeIdentity:$runtimeIdentity,runtimeOwned:$runtimeOwned,startedAt:$startedAt}' \
    | mso_private_state_atomic_write "$STATE_FILE" >/dev/null
}

gateway_active_state() {
  local state identity rc
  if state="$(gateway_state_read)"; then :; else rc=$?; return "$rc"; fi
  identity="$(jq -c '.tunnelIdentity // null' <<<"$state")"
  [ "$identity" != null ] && gateway_identity_matches "$identity" || return 1
  printf '%s' "$state"
}

gateway_cmd_local_start_locked() {
  local state
  state="$(gateway_state_read)"
  gateway_runtime_from_state "$state"
  gateway_start_runtime_if_needed
  if [ "$RUNTIME_STARTED_NOW" = true ] || [ "$RUNTIME_OWNED" = true ]; then
    if ! gateway_write_state local local "$LOCAL_URL" null; then
      [ "$RUNTIME_STARTED_NOW" = true ] && gateway_stop_identity "$RUNTIME_IDENTITY"
      gateway_fail "could not persist local runtime state; newly started runtime was rolled back"
    fi
  fi
  gateway_info "runtime: healthy MSO at $LOCAL_URL"
}

gateway_cmd_stop_locked() {
  local state tunnel runtime owned
  state="$(gateway_state_read)"
  tunnel="$(jq -c '.tunnelIdentity // null' <<<"$state")"
  runtime="$(jq -c '.runtimeIdentity // null' <<<"$state")"
  owned="$(jq -r '.runtimeOwned // false' <<<"$state")"
  [ "$tunnel" = null ] || gateway_stop_identity "$tunnel"
  [ "$owned" != true ] || [ "$runtime" = null ] || gateway_stop_identity "$runtime"
  mso_private_state_remove_file "$STATE_FILE" >/dev/null 2>&1 || true
  gateway_info "gateway stopped; MSO remains loopback-only"
}

gateway_cmd_status() {
  local state mode rc
  if state="$(gateway_active_state)"; then
    mode="$(jq -r .mode <<<"$state")"
    gateway_info "gateway: running"
    gateway_info "mode:    $mode"
    gateway_info "provider: $(jq -r .provider <<<"$state")"
    gateway_info "public:  $(jq -r .url <<<"$state")"
    gateway_info "local:   $(jq -r .localUrl <<<"$state")"
    [ "$mode" != temporary ] || gateway_info "note:    Quick Tunnel is preview-only; live Terminal SSE is not supported"
    return 0
  else
    rc=$?
  fi
  [ "$rc" = 1 ] || return "$rc"
  gateway_info "gateway: stopped"
  gateway_info "local:   $LOCAL_URL"
  gateway_health_ok && gateway_info "runtime: healthy MSO (loopback)" || gateway_info "runtime: not a verified MSO endpoint"
  return 1
}

gateway_cmd_url() {
  local state rc
  if state="$(gateway_active_state)"; then jq -r .url <<<"$state"; return 0; else rc=$?; fi
  [ "$rc" = 1 ] || return "$rc"
  gateway_fail "gateway is not running; run: mso gateway start"
}
