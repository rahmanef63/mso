#!/usr/bin/env bash
# Exact managed-app routes on an already MSO-owned named Cloudflare connector.

GATEWAY_APP_ROUTE_HELPER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/gateway-named-config.mjs"
# shellcheck source=scripts/lib/gateway-app-route-reload.sh
. "$(dirname "$GATEWAY_APP_ROUTE_HELPER")/gateway-app-route-reload.sh"

gateway_app_route_config() {
  node "$GATEWAY_APP_ROUTE_HELPER" "$ROOT" "$GATEWAY_CONFIG" "$GATEWAY_PUBLIC_URL" "$LOCAL_URL" \
    "$GATEWAY_APP_TEMPLATE" "$1" "$GATEWAY_APP_HOST" "$GATEWAY_APP_TUNNEL_ID"
}

gateway_app_route_expected_context() {
  local state="$1" action="$2" public expected
  jq -e --arg root "$GATEWAY_CANONICAL_ROOT" '.provider=="cloudflare-named" and .mode=="named" and .root==$root and .tunnelIdentity!=null' <<<"$state" >/dev/null \
    || gateway_fail "app routes require an existing MSO-owned named Cloudflare gateway"
  public="$(gateway_validate_public_origin "${OS_PUBLIC_ORIGIN:-}" 2>/dev/null || true)"
  expected="$(gateway_validate_public_origin "${GATEWAY_APP_EXPECT_PUBLIC:-}" 2>/dev/null || true)"
  [ -n "$expected" ] && [ "$public" = "$expected" ] && [ "$(jq -r .url <<<"$state")" = "$public" ] \
    || gateway_fail "expected public origin does not match this gateway and OS_PUBLIC_ORIGIN"
  GATEWAY_APP_TEMPLATE="${GATEWAY_APP_EXPECT_TEMPLATE:-${NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE:-}}"
  [ -n "$GATEWAY_APP_TEMPLATE" ] || gateway_fail "a managed app host template is required"
  if [ "$action" = ensure ]; then
    [ "$GATEWAY_APP_TEMPLATE" = "${NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE:-}" ] \
      || gateway_fail "managed app host template is not active in the gateway env file"
  fi
  GATEWAY_MODE=named; GATEWAY_PROVIDER=cloudflare-named; GATEWAY_PUBLIC_URL="$public"
}

gateway_app_route_owned_recipe() {
  local identity="$1" pid i found=0
  local -a argv
  jq -e '.cmdHash | type=="string" and test("^[0-9a-f]{64}$")' <<<"$identity" >/dev/null \
    || gateway_fail "named connector lacks an exact recorded command identity"
  gateway_identity_matches_retry "$identity" || gateway_fail "recorded named connector is not alive with its owned identity"
  pid="$(jq -r .pid <<<"$identity")"
  mapfile -d '' -t argv <"/proc/$pid/cmdline" || gateway_fail "cannot inspect the owned connector launch recipe"
  for ((i=0; i<${#argv[@]}; i++)); do
    [ "$((i+7))" = "${#argv[@]}" ] || continue
    if [ "${argv[$((i+1))]}" = tunnel ] && [ "${argv[$((i+2))]}" = --config ] &&
       [ "${argv[$((i+4))]}" = --no-autoupdate ] && [ "${argv[$((i+5))]}" = run ]; then
      CLOUDFLARED="${argv[$i]}"; GATEWAY_CONFIG="${argv[$((i+3))]}"; GATEWAY_TUNNEL="${argv[$((i+6))]}"; found=1; break
    fi
  done
  [ "$found" = 1 ] || gateway_fail "named connector does not match the MSO-owned launch recipe"
  [[ "$CLOUDFLARED" = /* && "$GATEWAY_CONFIG" = /* && "$GATEWAY_TUNNEL" =~ ^[A-Za-z0-9_-]{1,80}$ ]] \
    || gateway_fail "unsafe named connector launch recipe"
  [ "$GATEWAY_TUNNEL" = "$GATEWAY_APP_TUNNEL_ID" ] \
    || gateway_fail "owned connector must run the exact requested tunnel UUID"
  [ -f "$CLOUDFLARED" ] && [ ! -L "$CLOUDFLARED" ] && [ -x "$CLOUDFLARED" ] \
    || gateway_fail "recorded cloudflared executable is unavailable or unsafe"
  gateway_identity_matches "$identity" || gateway_fail "named connector changed during inspection"
}

gateway_app_route_context() {
  local action="$1" state identity
  state="$(gateway_state_read)" || gateway_fail "cannot read the selected gateway state"
  gateway_app_route_expected_context "$state" "$action"
  identity="$(jq -c .tunnelIdentity <<<"$state")"
  gateway_app_route_owned_recipe "$identity"
  GATEWAY_APP_STATE="$state"
  gateway_assert_port_loopback_only
  gateway_runtime_from_state "$state"
  gateway_assert_managed_runtime_trusted
  LOCAL_HEALTH_IDENTITY="$(gateway_health_url_identity "$LOCAL_URL" "${RUNTIME_INSTANCE_ID:-}")" \
    || gateway_fail "selected local MSO runtime is not healthy"
  gateway_health_url_matches_identity "$GATEWAY_PUBLIC_URL" "$LOCAL_HEALTH_IDENTITY" \
    || gateway_fail "public gateway does not match the selected local MSO runtime"
  GATEWAY_APP_INSPECTION="$(gateway_app_route_config inspect)" || return 1
}

gateway_app_route_receipt() {
  jq -c '{action,tunnelId,hostname}' <<<"$1"
}

gateway_app_route_inspect() {
  gateway_app_route_context inspect
  gateway_app_route_receipt "$GATEWAY_APP_INSPECTION"
}

gateway_app_route_ensure_locked() {
  local result
  gateway_app_route_restore_previous
  gateway_app_route_context ensure
  gateway_app_route_recover_pending
  result="$(gateway_app_route_config ensure)" || return 1
  if ! gateway_app_route_loaded "$result"; then
    gateway_app_route_reload "$result"
  fi
  gateway_app_route_receipt "$result"
}

gateway_cmd_app_route() {
  [ "$#" = 3 ] || gateway_fail "usage: mso gateway app-route inspect|ensure <hostname> <tunnel-uuid>"
  GATEWAY_APP_HOST="$2"; GATEWAY_APP_TUNNEL_ID="$3"
  # Provider status messages must never contaminate the JSON receipt on stdout.
  gateway_info() { printf '%s\n' "$*" >&2; }
  gateway_provider_load_cloudflare_adapter
  case "$1" in
    inspect) gateway_app_route_inspect ;;
    ensure) gateway_with_lock gateway_with_runtime_shared gateway_app_route_ensure_locked ;;
    *) gateway_fail "usage: mso gateway app-route inspect|ensure <hostname> <tunnel-uuid>" ;;
  esac
}
