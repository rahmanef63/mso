#!/usr/bin/env bash
# Agent/provider/gateway/browser/managed-app/terminal commands.
# Usage variables are defined by scripts/cli/commands.sh before this sourced handler runs.
# shellcheck disable=SC2154
mso_cmd_runtime() {
  local cmd="$1"; shift || true
case "$cmd" in
  agent|chat) run_agent "$@" ;;
  model) run_model_setup "$@" ;;
  setup) run_onboard "${1-}" ;;
  onboard) run_onboard "${1-}" ;;
  provider|providers) run_provider "$@" ;;

  # ── local/public gateway + browser launcher ───────────────────────────────
  gateway) local_url="$(gateway_local_url)"; MSO_GATEWAY_ROOT="$ROOT" MSO_GATEWAY_ENV="$ENVF" MSO_GATEWAY_LOCAL_URL="$local_url" "$ROOT/scripts/mso-gateway" "$@" ;;
  web)     local_url="$(gateway_local_url)"; MSO_GATEWAY_ROOT="$ROOT" MSO_GATEWAY_ENV="$ENVF" MSO_GATEWAY_LOCAL_URL="$local_url" "$ROOT/scripts/mso-gateway" web "$@" ;;

  # ── camoufox (the real browser the Browser app drives) ────────────────────
  camoufox)
    case "${1:-status}" in
      status)  jget "/api/v1/camoufox/service" ;;
      start)   jpost "/api/v1/camoufox/service" '{"action":"start"}' ;;
      stop)    jpost "/api/v1/camoufox/service" '{"action":"stop"}' ;;
      session) jget "/api/v1/camoufox/session" ;;
      *) die "usage: mso $U_camoufox" ;;
    esac ;;

  # ── managed apps (hermes, openclaw…) ─────────────────────────────────────
  apps) jget "/api/v1/apps" ;;
  mapp)
    sub="${1:-list}"; shift || true
    case "$sub" in
      list)    jget "/api/v1/managed-apps" ;;
      show)    jget "/api/v1/managed-apps/$(enc "${1:?id}")" ;;
      logs)    jget "/api/v1/managed-apps/$(enc "${1:?id}")/logs" ;;
      backups) jget "/api/v1/managed-apps/$(enc "${1:?id}")/backups" ;;
      jobs)    jget "/api/v1/managed-apps/$(enc "${1:?id}")/jobs" ;;
      job)     jget "/api/v1/managed-apps/$(enc "${1:?id}")/jobs/$(enc "${2:?jobId}")" ;;
      # Cached result only. The live probe is `update <id> check` (POST), gated.
      pending) jget "/api/v1/managed-apps/$(enc "${1:?id}")/update" ;;
      install) jpost "/api/v1/managed-apps/$(enc "${1:?id}")/install" "$(kv_args "${@:2}")" ;;
      update)  jpost "/api/v1/managed-apps/$(enc "${1:?id}")/update"  "$(kv_args "${@:2}")" ;;
      # start|stop|restart|backup — MANAGED_APP_ACTIONS in lib/managed-apps/types.ts.
      power)   [ -n "${2-}" ] || die "usage: mso mapp power <id> <start|stop|restart|backup>"
               jpost "/api/v1/managed-apps/$(enc "${1:?id}")" "$(jq -n --arg a "$2" '{action:$a}')" ;;
      cancel)  [ -n "${2-}" ] || die "usage: mso mapp cancel <id> <jobId>"
               jdel "/api/v1/managed-apps/$(enc "${1:?id}")/jobs/$(enc "$2")" ;;
      *) die "usage: mso $U_mapp" ;;
    esac ;;

  # ── terminal ─────────────────────────────────────────────────────────────
  term)
    sub="${1:-open}"; shift || true
    case "$sub" in
      # cols/rows are required by the route; a CLI has no viewport, so default to
      # the real terminal's size when there is one and 120x30 when piped.
      open)   jpost "/api/v1/term/open" "$(jq -n --arg c "${1-}" \
                --argjson x "${2:-$(tput cols 2>/dev/null || echo 120)}" \
                --argjson y "${3:-$(tput lines 2>/dev/null || echo 30)}" \
                '{cwd:$c,cols:$x,rows:$y}')" ;;
      input)  jpost "/api/v1/term/input" "$(jq -n --arg i "${1:?id}" --arg d "${2:?text}" '{id:$i,data:$d}')" ;;
      resize) jpost "/api/v1/term/resize" "$(jq -n --arg i "${1:?id}" --argjson c "${2:?cols}" --argjson r "${3:?rows}" '{id:$i,cols:$c,rows:$r}')" ;;
      stream) reqraw -N "$B/api/v1/term/stream?id=$(enc "${1:?id}")"; exit 0 ;;
      close)  jpost "/api/v1/term/close" "$(jq -n --arg i "${1:?id}" '{id:$i}')" ;;
      *) die "usage: mso $U_term" ;;
    esac ;;
  *) die "internal CLI routing error: $cmd reached the wrong command family" ;;
esac
}
