#!/usr/bin/env bash
# Assistant, sessions, A2A, memory/config/skills state commands.
mso_cmd_state() {
  local cmd="$1"; shift || true
case "$cmd" in
  # ── assistant / state ────────────────────────────────────────────────────
  ai) jpost "/api/assistant" "$(jq -n --arg m "$*" '{messages:[{role:"user",content:$m}]}')" ;;
  threads)
    case "${1:-list}" in
      list) jget "/api/threads" ;;
      show) jget "/api/threads?id=$(enc "${2:?id}")" ;;
      save) jpost "/api/threads" "${2:?json — {id,messages:[…]}}" ;;
      rm)   jdel "/api/threads?id=$(enc "${2:?id}")" ;;
      *) die "usage: mso $U_threads" ;;
    esac ;;
  agent-sessions)
    case "${1:-list}" in
      list)   jget "/api/v1/agent-sessions${2:+?limit=$(enc "$2")}" ;;
      show)   jget "/api/v1/agent-sessions?id=$(enc "${2:?id}")" ;;
      create) jpost "/api/v1/agent-sessions" "$(jq -n --arg title "${2:-MSO Agent session}" '{action:"create",title:$title}')" ;;
      *) die "usage: mso $U_agent_sessions" ;;
    esac ;;
  agents)
    sub="${1:-list}"; shift || true
    case "$sub" in
      list)
        current="${1:-}"
        if [ -n "$current" ]; then jget "/api/v1/local-agents?session=$(enc "$current")";
        else jget "/api/v1/local-agents"; fi ;;
      send)
        source_id="${1:?source-session-id}"; target="${2:?target}"; message="${3:?message}"; kind="${4:-message}"
        [ "$kind" = "message" ] || [ "$kind" = "task" ] || die "kind must be message or task"
        jpost "/api/v1/local-agents" "$(jq -n --arg sid "$source_id" --arg target "$target" --arg message "$message" --arg kind "$kind" '{action:"send",sessionId:$sid,target:$target,message:$message,kind:$kind}')" ;;
      inbox)
        session_id="${1:?session-id}"; include="${2:-}"
        [ "$include" = "" ] || [ "$include" = "--all" ] || die "usage: mso $U_agents"
        jget "/api/v1/local-agents?inbox=1&session=$(enc "$session_id")$([ "$include" = "--all" ] && printf '&includeRead=1')" ;;
      *) die "usage: mso $U_agents" ;;
    esac ;;
  a2a)
    sub="${1:-list}"; shift || true
    case "$sub" in
      list) jget "/api/v1/a2a" ;;
      state) jget "/api/v1/a2a?action=state" ;;
      sessions) jget "/api/v1/a2a?action=local-sessions" ;;
      discover) jget "/api/v1/a2a?action=discover&url=$(enc "${1:?url}")" ;;
      add|register)
        url="${1:?url}"; alias="${2:-}"
        jpost "/api/v1/a2a" "$(jq -n --arg url "$url" --arg alias "$alias" '{action:"register",url:$url} + (if $alias == "" then {} else {alias:$alias} end)')" ;;
      rm|remove) jpost "/api/v1/a2a" "$(jq -n --arg target "${1:?target}" '{action:"remove",target:$target}')" ;;
      send)
        target="${1:?target}"; message="${2:?message}"; wait="${3:-}"
        [ "$wait" = "" ] || [ "$wait" = "--wait" ] || die "usage: mso $U_a2a"
        jpost "/api/v1/a2a" "$(jq -n --arg target "$target" --arg message "$message" --arg wait "$wait" '{action:"send",target:$target,message:$message,returnImmediately:($wait != "--wait")}')" ;;
      stream)
        target="${1:?target}"; message="${2:?message}"
        body="$(jq -n --arg target "$target" --arg message "$message" '{action:"stream",target:$target,message:$message}')"
        JAR=$(mso_private_state_ensure_file "$JAR") || die "refusing unsafe cookie jar: $JAR"; [ -s "$JAR" ] || login
        reqraw -N -H 'content-type: application/json' -d "$body" "$B/api/v1/a2a" ;;
      task|status)
        target="${1:?target}"; task_id="${2:?taskId}"; history="${3:-10}"
        [[ "$history" =~ ^[0-9]+$ ]] || die "history must be 0-100"; [ "$history" -le 100 ] || die "history must be 0-100"
        jget "/api/v1/a2a?action=task&target=$(enc "$target")&taskId=$(enc "$task_id")&historyLength=$history" ;;
      cancel) jpost "/api/v1/a2a" "$(jq -n --arg target "${1:?target}" --arg taskId "${2:?taskId}" '{action:"cancel",target:$target,taskId:$taskId}')" ;;
      handoff|delegate)
        target="${1:?target}"; objective="${2:?objective}"; context="${3:-}"; wait="${4:-}"
        if [ "$context" = "--wait" ]; then wait="--wait"; context=""; fi
        [ "$wait" = "" ] || [ "$wait" = "--wait" ] || die "usage: mso $U_a2a"
        jpost "/api/v1/a2a" "$(jq -n --arg target "$target" --arg objective "$objective" --arg context "$context" --arg wait "$wait" '{action:"handoff",target:$target,objective:$objective,returnImmediately:($wait != "--wait")} + (if $context == "" then {} else {context:$context} end)')" ;;
      spawn)
        source_ref="${1:?sourceSession}"; objective="${2:?objective}"; title="${3:-}"
        jpost "/api/v1/a2a" "$(jq -n --arg sourceSessionRef "$source_ref" --arg objective "$objective" --arg title "$title" '{action:"local-spawn",sourceSessionRef:$sourceSessionRef,objective:$objective} + (if $title == "" then {} else {title:$title} end)')" ;;
      inbox)
        session_ref="${1:?session}"
        jget "/api/v1/a2a?action=local-inbox&session=$(enc "$session_ref")" ;;
      local)
        local_sub="${1:-sessions}"; shift || true
        case "$local_sub" in
          sessions|list) jget "/api/v1/a2a?action=local-sessions" ;;
          handoff|delegate)
            session_ref="${1:?session}"; objective="${2:?objective}"
            jpost "/api/v1/a2a" "$(jq -n --arg sessionRef "$session_ref" --arg objective "$objective" '{action:"local-handoff",sessionRef:$sessionRef,objective:$objective}')" ;;
          spawn)
            source_ref="${1:?sourceSession}"; objective="${2:?objective}"; title="${3:-}"
            jpost "/api/v1/a2a" "$(jq -n --arg sourceSessionRef "$source_ref" --arg objective "$objective" --arg title "$title" '{action:"local-spawn",sourceSessionRef:$sourceSessionRef,objective:$objective} + (if $title == "" then {} else {title:$title} end)')" ;;
          inbox)
            session_ref="${1:?session}"
            jget "/api/v1/a2a?action=local-inbox&session=$(enc "$session_ref")" ;;
          *) die "usage: mso $U_a2a" ;;
        esac ;;
      auth)
        auth_sub="${1:-list}"; shift || true
        case "$auth_sub" in
          list)
            if [ -n "${1-}" ]; then agent_id="$(a2a_agent_id "$1")"; jget "/api/v1/a2a?action=credentials&agentId=$(enc "$agent_id")";
            else jget "/api/v1/a2a?action=credentials"; fi ;;
          add)
            target="${1:?target}"; label="${2:-default}"; kind="${3:-bearer}"
            case "$kind" in bearer|api-key|oauth2) ;; *) die "credential kind must be bearer, api-key, or oauth2" ;; esac
            agent_id="$(a2a_agent_id "$target")"; header_name=""; scheme_name=""
            schemes="$(a2a_agent_schemes "$agent_id")"; scheme_count="$(printf '%s\n' "$schemes" | sed '/^$/d' | wc -l | tr -d ' ')"
            if [ "$scheme_count" -eq 1 ]; then scheme_name="$(printf '%s\n' "$schemes" | sed '/^$/d' | head -1)";
            elif [ "$scheme_count" -gt 1 ]; then
              default_scheme="$(printf '%s\n' "$schemes" | sed '/^$/d' | head -1)"
              tty_line "Agent Card scheme [$default_scheme]: " "$default_scheme"; scheme_name="$REPLY"
              printf '%s\n' "$schemes" | grep -Fxq -- "$scheme_name" || die "unknown Agent Card security scheme: $scheme_name"
            fi
            scheme_json="{}"; [ -z "$scheme_name" ] || scheme_json="$(a2a_agent_scheme_json "$agent_id" "$scheme_name")"
            scheme_kind="$(printf '%s' "$scheme_json" | jq -r '.kind // empty')"
            case "$scheme_kind" in
              api-key)
                [ "$kind" = "api-key" ] || die "Agent Card scheme $scheme_name requires credential kind api-key"
                scheme_location="$(printf '%s' "$scheme_json" | jq -r '.location // empty')"
                [ "$scheme_location" = "header" ] || die "MSO 1.8 supports header API keys only; scheme $scheme_name uses ${scheme_location:-unknown}"
                default_header="$(printf '%s' "$scheme_json" | jq -r '.name // "X-API-Key"')"
                tty_line "API-key header [$default_header]: " "$default_header"; header_name="$REPLY"
                [ "${header_name,,}" = "${default_header,,}" ] || die "API-key header must match Agent Card header: $default_header" ;;
              http)
                http_scheme="$(printf '%s' "$scheme_json" | jq -r '.scheme // empty')"
                [ "${http_scheme,,}" = "bearer" ] || die "unsupported A2A HTTP auth scheme: ${http_scheme:-unknown}"
                [ "$kind" = "bearer" ] || die "Agent Card scheme $scheme_name requires credential kind bearer" ;;
              oauth2|openid)
                [ "$kind" = "oauth2" ] || die "Agent Card scheme $scheme_name requires credential kind oauth2" ;;
              mtls) die "A2A mTLS credential profiles are not supported in MSO 1.8" ;;
              unknown) die "unsupported or invalid A2A security scheme: $scheme_name" ;;
              '')
                if [ "$kind" = "api-key" ]; then tty_line "API-key header [X-API-Key]: " "X-API-Key"; header_name="$REPLY"; fi ;;
              *) die "unsupported A2A security scheme kind: $scheme_kind" ;;
            esac
            tty_secret "Credential secret: "; secret="$REPLY"; [ -n "$secret" ] || die "credential secret is required"
            body="$(printf '%s' "$secret" | a2a_credential_body "$agent_id" "$label" "$kind" "$header_name" "$scheme_name")"; unset secret REPLY
            secret_post "/api/v1/a2a" "$body"; unset body ;;
          use)
            target="${1:?target}"; credential_id="${2:?credentialId or none}"; [ "$credential_id" = "none" ] && credential_id=""
            jpost "/api/v1/a2a" "$(jq -n --arg target "$target" --arg credentialId "$credential_id" '{action:"credential-use",target:$target,credentialId:$credentialId}')" ;;
          rm|remove) jpost "/api/v1/a2a" "$(jq -n --arg credentialId "${1:?credentialId}" '{action:"credential-remove",credentialId:$credentialId}')" ;;
          *) die "usage: mso $U_a2a" ;;
        esac ;;
      inbound)
        in_sub="${1:-list}"; shift || true
        case "$in_sub" in
          list) jget "/api/v1/a2a?action=credentials" ;;
          create|add)
            label="${1:-peer}"; scope="${2:-read}"; case "$scope" in read|write|exec) ;; *) die "scope must be read, write, or exec" ;; esac
            jpost "/api/v1/a2a" "$(jq -n --arg label "$label" --arg scope "$scope" '{action:"inbound-token-create",label:$label,scope:$scope}')" ;;
          rm|remove) jpost "/api/v1/a2a" "$(jq -n --arg tokenId "${1:?tokenId}" '{action:"inbound-token-remove",tokenId:$tokenId}')" ;;
          *) die "usage: mso $U_a2a" ;;
        esac ;;
      *) die "usage: mso $U_a2a" ;;
    esac ;;
  memory)
    case "${1:-list}" in
      list) jget "/api/memory" ;;
      add)  jpost "/api/memory" "$(jq -n --arg t "${2:?text}" '{text:$t}')" ;;
      rm)   jdel "/api/memory?id=$(enc "${2:?id}")" ;;
      *) die "usage: mso $U_memory" ;;
    esac ;;
  config)
    case "${1:-show}" in
      show) jget "/api/config" ;;
      set)  jpost "/api/config" "$(json_arg "${2:?json, e.g. '{\"model\":\"gpt-5.6\"}'}")" ;;
      key)  provider="${2:?provider}"
            case "$provider" in anthropic|openai|openrouter|google|groq|xai|deepseek|mistral) ;;
              *) die "API-key provider must be one of: anthropic openai openrouter google groq xai deepseek mistral" ;; esac
            tty_secret "Paste $provider API key: "; key="$REPLY"
            [ -n "$key" ] || die "empty API key"
            body=$(printf '%s\0%s' "$provider" "$key" | provider_key_body)
            secret_post "/api/config" "$body"; unset key body REPLY ;;
      style) style="${2:?off|caveman|ponytail}"
             case "$style" in off|caveman|ponytail) ;; *) die "style must be off, caveman or ponytail" ;; esac
             jpost "/api/config" "$(jq -nc --arg v "$style" '{tokenSaver:$v}')" ;;
      rm)   jdel "/api/config?provider=$(enc "${2:?provider}")" ;;
      *) die "usage: mso $U_config" ;;
    esac ;;
  prefs)
    case "${1:-show}" in
      show) jget "/api/prefs" ;;
      set)  jpost "/api/prefs" "$(json_arg "${2:?json, e.g. '{\"tweaks\":{\"theme\":\"dark\"}}'}")" ;;
      *) die "usage: mso $U_prefs" ;;
    esac ;;
  models) run_models "$@" ;;
  skills)
    case "${1:-list}" in
      list)   jget "/api/skills" ;;
      read)   [ -n "${2-}" ] || die "usage: mso $U_skills"
              jget "/api/skills?name=$(enc "$2")" ;;
      search) shift; [ $# -gt 0 ] || die "usage: mso $U_skills"
              jget "/api/skills?q=$(enc "$*")" ;;
      available) shift; node "$ROOT/scripts/skill-market.mjs" available "$@" ;;
      info)    shift; node "$ROOT/scripts/skill-market.mjs" info "$@" ;;
      install) shift; node "$ROOT/scripts/skill-market.mjs" install "$@" ;;
      remove|rm) shift; node "$ROOT/scripts/skill-market.mjs" remove "$@" ;;
      *)      jget "/api/skills?name=$(enc "$1")" ;;
    esac ;;
  # Generated from git subjects by scripts/gen-changelog.mjs; `jq -r` because the
  # value is a markdown document, not a data structure to pretty-print.
  changelog) jget "/api/changelog" | jq -r .markdown ;;
  stock)  jget "/api/v1/stock/search?q=$(enc "${1:?query}")&page=${2:-1}" ;;
  *) die "internal CLI routing error: $cmd reached the wrong command family" ;;
esac
}
