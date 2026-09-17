#!/usr/bin/env bash
# Read-only gateway observation/classification. This layer never starts, stops,
# adopts, restarts, or rewrites a provider process.

gateway_configured_public_origin() {
  local candidate="${OS_PUBLIC_ORIGIN:-}"
  [ -n "$candidate" ] || return 1
  gateway_validate_public_origin "$candidate" 2>/dev/null
}

gateway_public_observation() {
  local public="$1" local_identity="$2" body actual health=unknown
  [ -n "$public" ] || { jq -nc '{health:"not-configured",identity:null,responder:false}'; return 0; }
  body="$(gateway_fetch_health_body "$public" 2>/dev/null || true)"
  [ -n "$body" ] || { jq -nc '{health:"failing",identity:null,responder:false}'; return 0; }
  actual="$(gateway_health_identity_from_body "$body" 2>/dev/null || true)"
  if [ -z "$actual" ]; then
    jq -nc '{health:"invalid",identity:null,responder:true}'
    return 0
  fi
  if [ -z "$local_identity" ]; then
    health=unverified
  elif [ "$(jq -cS . <<<"$actual")" = "$(jq -cS . <<<"$local_identity")" ]; then
    health=healthy
  else
    health=identity-mismatch
  fi
  jq -nc --arg health "$health" --argjson identity "$actual" '{health:$health,identity:$identity,responder:true}'
}

gateway_observe_state() {
  local stored rc tunnel raw_provider provider mode public configured local_identity local_health
  local process_health ownership supervisor public_obs public_health provider_health state capabilities managed_recorded runtime_owned
  if stored="$(gateway_state_read)"; then :; else
    rc=$?
    jq -nc --arg local "$LOCAL_URL" '{state:"unknown",legacyState:"unknown",ownership:"unknown",provider:"unknown",providerDetail:null,supervisor:"unknown",local:$local,public:null,localHealth:"unknown",publicHealth:"unknown",providerHealth:"unknown",processHealth:"unknown",capabilities:{},stateError:"unsafe-or-corrupt"}'
    return "$rc"
  fi

  local_identity="$(gateway_health_url_identity "$LOCAL_URL" 2>/dev/null || true)"
  if [ -n "$local_identity" ]; then local_health=healthy; else local_health=unhealthy; fi

  tunnel="$(jq -c '.tunnelIdentity // null' <<<"$stored")"
  raw_provider="$(jq -r '.provider // empty' <<<"$stored")"
  mode="$(jq -r '.mode // empty' <<<"$stored")"
  public="$(gateway_validate_public_origin "$(jq -r '.url // empty' <<<"$stored")" 2>/dev/null || true)"
  configured="$(gateway_configured_public_origin 2>/dev/null || true)"
  [ -n "$public" ] || public="$configured"

  runtime_owned="$(jq -r '.runtimeOwned // false' <<<"$stored")"
  managed_recorded=false
  if [ "$tunnel" != null ]; then managed_recorded=true
  elif [ -n "$raw_provider" ] && [ "$raw_provider" != local ] && [ "$mode" != local ] && [ "$runtime_owned" = true ]; then managed_recorded=true
  fi
  if [ "$managed_recorded" = true ]; then
    ownership=mso
    provider="$(gateway_provider_family "${raw_provider:-cloudflare}")"
    if [ "$tunnel" != null ] && gateway_identity_matches_retry "$tunnel" 2; then process_health=alive; else process_health=stale; fi
  else
    ownership=none
    provider="$(gateway_provider_family "${raw_provider:-custom}")"
    process_health=not-applicable
  fi

  public_obs="$(gateway_public_observation "$public" "$local_identity")"
  public_health="$(jq -r .health <<<"$public_obs")"

  if [ "$ownership" = mso ]; then
    if [ "$process_health" = alive ] && [ "$local_health" = healthy ] && [ "$public_health" = healthy ]; then
      state=managed-running; provider_health=healthy
    elif [ "$process_health" = stale ]; then
      state=recovering; provider_health=stale
    else
      state=degraded; provider_health=degraded
    fi
  elif [ "$(jq -r .responder <<<"$public_obs")" = true ]; then
    ownership=external
    process_health=external
    provider="$(gateway_provider_family "${raw_provider:-custom}")"
    if [ "$local_health" = healthy ] && [ "$public_health" = healthy ]; then
      state=external-running; provider_health=healthy
    else
      state=degraded; provider_health=degraded
    fi
  else
    state=stopped; provider_health=unknown
  fi

  supervisor="$(gateway_provider_supervisor "$ownership")"
  capabilities="$(gateway_provider_capabilities_json "$provider")"
  jq -nc \
    --arg state "$state" \
    --arg legacyState "$([ "$state" = managed-running ] || [ "$state" = external-running ] && printf running || { [ "$state" = stopped ] && printf stopped || printf "$state"; })" \
    --arg ownership "$ownership" --arg provider "$provider" --arg providerDetail "${raw_provider:-}" \
    --arg supervisor "$supervisor" --arg local "$LOCAL_URL" --arg public "$public" --arg mode "$mode" \
    --arg localHealth "$local_health" --arg publicHealth "$public_health" \
    --arg providerHealth "$provider_health" --arg processHealth "$process_health" \
    --argjson capabilities "$capabilities" --argjson localIdentity "${local_identity:-null}" \
    --argjson publicIdentity "$(jq -c '.identity' <<<"$public_obs")" \
    '{state:$state,legacyState:$legacyState,ownership:$ownership,provider:$provider,providerDetail:(if $providerDetail=="" then null else $providerDetail end),supervisor:$supervisor,mode:(if $mode=="" then null else $mode end),local:$local,public:(if $public=="" then null else $public end),localHealth:$localHealth,publicHealth:$publicHealth,providerHealth:$providerHealth,processHealth:$processHealth,capabilities:$capabilities,localIdentity:$localIdentity,publicIdentity:$publicIdentity}'
}

gateway_status_exit_code() {
  case "$1" in
    managed-running|external-running) return 0 ;;
    stopped) return 1 ;;
    *) return 2 ;;
  esac
}
