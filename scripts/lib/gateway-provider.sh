#!/usr/bin/env bash
# Provider-neutral gateway adapter boundary. Core lifecycle/state code calls this
# file; provider-specific Cloudflare implementation remains in gateway-tool.sh and
# gateway-tunnel.sh. New providers should implement the same small contract rather
# than branching provider names through the core.

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
      cloudflare) gateway_cmd_start_locked ;;
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
      cloudflare) gateway_cmd_start_locked ;;
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
    cloudflare) gateway_cmd_start_locked ;;
    *) gateway_fail "provider '$provider' is not implemented for managed start yet" ;;
  esac
}

gateway_provider_doctor_readonly() {
  local provider="$(gateway_provider_family "${1:-custom}")"
  case "$provider" in
    cloudflare)
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

gateway_provider_supervisor() {
  local ownership="$1" explicit="${MSO_GATEWAY_SUPERVISOR:-}"
  if [ -n "$explicit" ]; then printf '%s\n' "$explicit"; return 0; fi
  case "$ownership" in
    mso) printf '%s\n' mso-lifecycle ;;
    external) printf '%s\n' external ;;
    *) printf '%s\n' unknown ;;
  esac
}
