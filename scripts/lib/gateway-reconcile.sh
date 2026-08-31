#!/usr/bin/env bash
# Reconcile an already-live tunnel with the selected local runtime before reuse.

gateway_reconcile_active_tunnel() {
  local state="$1" existing_tunnel provider mode public
  existing_tunnel="$(jq -c '.tunnelIdentity // null' <<<"$state")"
  [ "$existing_tunnel" != null ] && gateway_identity_matches_retry "$existing_tunnel" \
    || gateway_fail "active gateway state no longer matches its tunnel process"
  provider="$(jq -r '.provider // "cloudflare-quick"' <<<"$state")"
  mode="$(jq -r '.mode // "temporary"' <<<"$state")"
  public="$(gateway_validate_public_origin "$(jq -r '.url // empty' <<<"$state")" 2>/dev/null || true)"
  [ -n "$public" ] || gateway_fail "active gateway state has an invalid public origin"

  # Keep the already-live tunnel outside pending cleanup. If runtime recovery or
  # public verification fails, the old tunnel remains for diagnosis; only a newly
  # started fallback runtime is rolled back.
  TUNNEL_IDENTITY=null
  GATEWAY_PROVIDER="$provider"; GATEWAY_MODE="$mode"; GATEWAY_PUBLIC_URL="$public"
  gateway_assert_port_loopback_only
  gateway_runtime_from_state "$state"
  gateway_start_runtime_if_needed
  gateway_assert_port_loopback_only
  LOCAL_HEALTH_IDENTITY="$(gateway_health_url_identity "$LOCAL_URL" "${RUNTIME_INSTANCE_ID:-}")" \
    || { gateway_reconcile_runtime_rollback; gateway_fail "active tunnel has no verified local MSO runtime"; }
  if ! gateway_probe_public; then
    gateway_reconcile_runtime_rollback
    gateway_fail "active tunnel did not return the selected local MSO health identity"
  fi

  TUNNEL_IDENTITY="$existing_tunnel"
  if ! gateway_write_state "$provider" "$mode" "$public" "$existing_tunnel"; then
    TUNNEL_IDENTITY=null
    gateway_reconcile_runtime_rollback
    gateway_fail "recovered runtime is healthy but gateway state could not be persisted"
  fi
  GATEWAY_PENDING_CLEANUP=0
  gateway_cmd_status
}

gateway_reconcile_runtime_rollback() {
  if [ "${RUNTIME_STARTED_NOW:-false}" = true ] && [ "${RUNTIME_IDENTITY:-null}" != null ]; then
    gateway_stop_identity "$RUNTIME_IDENTITY"
  else
    gateway_stop_pending_runtime
  fi
  RUNTIME_IDENTITY=null; RUNTIME_INSTANCE_ID=''; RUNTIME_OWNED=false; RUNTIME_STARTED_NOW=false
  GATEWAY_PENDING_CLEANUP=0
}
