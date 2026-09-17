#!/usr/bin/env bash
# Provider-neutral gateway adapter boundary. Core lifecycle/state code calls this
# file; provider-specific Cloudflare implementation remains in gateway-tool.sh and
# gateway-tunnel.sh. New providers should implement the same small contract rather
# than branching provider names through the core.

GATEWAY_CLOUDFLARE_ADAPTER_LOADED=0
gateway_provider_load_cloudflare_adapter() {
  [ "$GATEWAY_CLOUDFLARE_ADAPTER_LOADED" = 1 ] && return 0
  # Provider-specific tool/tunnel code is loaded only through this boundary.
  # shellcheck source=scripts/lib/gateway-tool.sh
  . "$ROOT/scripts/lib/gateway-tool.sh"
  # shellcheck source=scripts/lib/gateway-tunnel.sh
  . "$ROOT/scripts/lib/gateway-tunnel.sh"
  # shellcheck source=scripts/lib/gateway-cloudflare-edge.sh
  . "$ROOT/scripts/lib/gateway-cloudflare-edge.sh"
  GATEWAY_CLOUDFLARE_ADAPTER_LOADED=1
}

gateway_provider_family() {
  case "${1:-}" in
    cloudflare|cloudflare-quick|cloudflare-named) printf '%s\n' cloudflare ;;
    local) printf '%s\n' local ;;
    custom|external|'') printf '%s\n' custom ;;
    *) printf '%s\n' "$1" ;;
  esac
}

gateway_provider_capabilities_json() {
  local provider
  provider="$(gateway_provider_family "${1:-custom}")"
  case "$provider" in
    cloudflare)
      jq -nc '{publicHealthProbe:true,managedProcess:true,namedEndpoint:true,externalDetection:true,restart:true,reconnect:true,credentialsRequired:true,dnsRouting:true}'
      ;;
    local)
      jq -nc '{publicHealthProbe:false,managedProcess:false,namedEndpoint:false,externalDetection:false,restart:false,reconnect:false,credentialsRequired:false,dnsRouting:false}'
      ;;
    *)
      jq -nc '{publicHealthProbe:true,managedProcess:false,namedEndpoint:true,externalDetection:true,restart:false,reconnect:false,credentialsRequired:false,dnsRouting:false}'
      ;;
  esac
}

gateway_provider_default() { printf '%s\n' cloudflare; }

gateway_provider_parse_start_args() {
  GATEWAY_SELECTED_PROVIDER="$(gateway_provider_default)"
  # Backward-compatible Cloudflare adapter arguments remain the current default.
  gateway_provider_load_cloudflare_adapter
  gateway_parse_start_args "$@"
}

gateway_provider_start_locked() {
  local active observed state ownership provider rc
  provider="${GATEWAY_SELECTED_PROVIDER:-$(gateway_provider_default)}"

  # Preserve the established managed lifecycle/race path without adding a public
  # probe before every start. The adapter itself handles active reconciliation and
  # explicit named-start semantics under the same lifecycle lock.
  if active="$(gateway_active_state)"; then
    case "$(gateway_provider_family "$provider")" in
      cloudflare) gateway_provider_load_cloudflare_adapter; gateway_cmd_start_locked ;;
      *) gateway_fail "provider '$provider' is not implemented for managed start yet" ;;
    esac
    return $?
  else
    rc=$?
  fi
  [ "$rc" = 1 ] || return "$rc"

  # Explicit named-provider starts are deliberate operator actions. They continue
  # through the existing provider validator rather than being inferred as an
  # ownership takeover from public-route observation.
  if [ -n "${GATEWAY_CONFIG:-}${GATEWAY_TUNNEL:-}" ]; then
    case "$(gateway_provider_family "$provider")" in
      cloudflare) gateway_provider_load_cloudflare_adapter; gateway_cmd_start_locked ;;
      *) gateway_fail "provider '$provider' is not implemented for managed start yet" ;;
    esac
    return $?
  fi

  # Only an implicit/default start needs external-route duplicate prevention.
  # Observation is read-only: a detected external route is never adopted/mutated.
  observed="$(gateway_observe_state)" || return $?
  state="$(jq -r .state <<<"$observed")"
  ownership="$(jq -r .ownership <<<"$observed")"
  if [ "$ownership" = external ] && { [ "$state" = external-running ] || [ "$state" = degraded ]; }; then
    gateway_fail "configured public gateway is externally managed; refusing to create a duplicate connector from an implicit start"
  fi

  case "$(gateway_provider_family "$provider")" in
    cloudflare) gateway_provider_load_cloudflare_adapter; gateway_cmd_start_locked ;;
    *) gateway_fail "provider '$provider' is not implemented for managed start yet" ;;
  esac
}

gateway_provider_doctor_readonly() {
  local provider
  provider="$(gateway_provider_family "${1:-custom}")"
  case "$provider" in
    cloudflare)
      gateway_provider_load_cloudflare_adapter
      # Explicitly disable the resolver's install path: doctor is observational.
      if MSO_GATEWAY_NO_AUTO_INSTALL=1 gateway_resolve_cloudflared >/dev/null 2>&1; then
        gateway_info "  ok    provider cloudflare: $("$CLOUDFLARED" --version 2>/dev/null | head -1)"
      else
        gateway_info "  warn  provider cloudflare: managed binary unavailable (doctor did not install it)"
      fi
      ;;
    local) gateway_info "  info  provider local: no public provider process" ;;
    *) gateway_info "  info  provider $provider: externally/custom managed; MSO will inspect but not mutate it" ;;
  esac
}

gateway_provider_install() {
  local provider
  provider="$(gateway_provider_family "${1:-$(gateway_provider_default)}")"
  case "$provider" in
    cloudflare) gateway_provider_load_cloudflare_adapter; gateway_cmd_install_tool ;;
    *) gateway_fail "provider '$provider' has no MSO-managed install adapter" ;;
  esac
}

gateway_provider_probe_public() {
  local provider
  provider="$(gateway_provider_family "${1:-custom}")"
  case "$provider" in
    cloudflare) gateway_provider_load_cloudflare_adapter; gateway_probe_public ;;
    *) gateway_health_url_matches_identity "$GATEWAY_PUBLIC_URL" "$LOCAL_HEALTH_IDENTITY" ;;
  esac
}

gateway_provider_domain_hint() {
  local provider origin="$2" domain_host
  provider="$(gateway_provider_family "${1:-$(gateway_provider_default)}")"
  domain_host="${origin#https://}"
  case "$provider" in
    cloudflare)
      cat <<CFG
named Cloudflare config example:
  tunnel: <TUNNEL-UUID>
  credentials-file: $HOME/.cloudflared/<TUNNEL-UUID>.json
  ingress:
    - hostname: $domain_host
      service: $LOCAL_URL
    - service: http_status:404
then: cloudflared tunnel route dns <TUNNEL-UUID-or-name> $domain_host
and:  mso gateway start --config ~/.cloudflared/config.yml --tunnel <TUNNEL-UUID-or-name>
CFG
      ;;
    *) gateway_info "configure provider '$provider' to route $origin to $LOCAL_URL; MSO will verify it through /api/health" ;;
  esac
}

gateway_provider_supervisor() {
  local ownership="$1" explicit="${MSO_GATEWAY_SUPERVISOR:-}"
  if [ -n "$explicit" ]; then printf '%s\n' "$explicit"; return 0; fi
  case "$ownership" in
    mso) printf '%s\n' mso-lifecycle ;;
    external) printf '%s\n' external ;;
    *) printf '%s\n' unknown ;;
  esac
}
