#!/usr/bin/env bash
# Structured MSO health identity fetch/match helpers.

gateway_health_body_ok() {
  local body="$1" expected_instance="${2-}"
  [ -n "$body" ] || return 1
  jq -e --arg version "$GATEWAY_EXPECTED_VERSION" --arg instance "$expected_instance" '
    type == "object" and .status == "ok" and .version == $version and
    (.buildId | type == "string") and (.buildId | length > 0) and has("runtimeInstanceId") and
    (if $instance == "" then true else .runtimeInstanceId == $instance end)
  ' <<<"$body" >/dev/null 2>&1
}

gateway_health_identity_from_body() {
  local body="$1" expected_instance="${2-}"
  gateway_health_body_ok "$body" "$expected_instance" || return 1
  jq -c '{version,buildId,runtimeInstanceId}' <<<"$body"
}

gateway_fetch_health_body() {
  local base="$1" loopback
  local -a curl_args=(-fsS --max-time 4)
  loopback="$(gateway_validate_loopback_origin "$base" 2>/dev/null || true)"
  [ -z "$loopback" ] || curl_args+=(--noproxy '*')
  "$CURL" "${curl_args[@]}" "$base/api/health" 2>/dev/null
}

gateway_health_url_identity() {
  local body
  body="$(gateway_fetch_health_body "$1" 2>/dev/null || true)"
  gateway_health_identity_from_body "$body" "${2-}"
}

gateway_health_url_ok() { gateway_health_url_identity "$1" "${2-}" >/dev/null; }

gateway_health_body_matches_identity() {
  local actual
  actual="$(gateway_health_identity_from_body "$1" 2>/dev/null || true)"
  [ -n "$actual" ] && [ "$actual" = "$2" ]
}

gateway_health_url_matches_identity() {
  local actual
  actual="$(gateway_health_url_identity "$1" 2>/dev/null || true)"
  [ -n "$actual" ] && [ "$actual" = "$2" ]
}

gateway_health_ok() { gateway_health_url_ok "$LOCAL_URL"; }

gateway_wait_health() {
  local expected_instance="${1-}" i
  for i in $(seq 1 40); do gateway_health_url_ok "$LOCAL_URL" "$expected_instance" && return 0; sleep 0.25; done
  return 1
}
