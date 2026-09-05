#!/usr/bin/env bash
# Native connection management. All actions use the same owner API as the browser.
run_integrations() {
  local sub="${1:-status}" data user provider connection query body
  shift || true
  case "$sub" in
    status|users|catalog)
      query="snapshot"; [ "$sub" = users ] && query=users; [ "$sub" = catalog ] && query=catalog
      jget "/api/v1/integrations?view=$query" ;;
    connections)
      query="view=connections"; [ -n "${1-}" ] && query="$query&user=$(enc "$1")"; [ -n "${2-}" ] && query="$query&provider=$(enc "$2")"
      jget "/api/v1/integrations?$query" ;;
    which) jget "/api/v1/integrations?view=which&cwd=$(enc "${1:-$PWD}")" ;;
    request|resolve)
      [ $# -ge 2 ] || die "usage: mso integrations $sub <user> <provider> [connection]"
      query="view=$sub&user=$(enc "$1")&provider=$(enc "$2")"; [ -n "${3-}" ] && query="$query&connection=$(enc "$3")"
      jget "/api/v1/integrations?$query" ;;
    setup)
      [ $# -eq 3 ] || die "usage: mso integrations setup <user> <provider> <connection>"
      tty_ok || die "private setup links are terminal-only; use integration_setup_open from MCP"
      user="$1"; provider="$2"; connection="$3"
      data=$(jpost "/api/v1/infra/setup" "$(jq -nc --arg user "$user" --arg provider "$provider" --arg connection "$connection" '{user:$user,provider:$provider,connection:$connection}')")
      printf 'Private setup for %s / %s / %s (10 minutes; do not share):\n%s#%s\n' "$user" "$provider" "$connection" "$(jq -r '.setupUrl' <<<"$data")" "$(jq -r '.token' <<<"$data")"
      unset data ;;
    create-user)
      [ $# -ge 1 ] || die "usage: mso integrations create-user <id> [label]"
      body=$(jq -nc --arg user "$1" --arg label "${2:-$1}" '{mode:"manage",action:"user.create",confirm:true,user:$user,label:$label}')
      jpost "/api/v1/integrations" "$body" ;;
    create-connection)
      [ $# -ge 5 ] || die "usage: mso integrations create-connection <user> <provider> <id> <direct|composio|native-mcp> <auth-method> [label]"
      body=$(jq -nc --arg user "$1" --arg provider "$2" --arg connection "$3" --arg source "$4" --arg authMethod "$5" --arg label "${6:-$3}" '{mode:"manage",action:"connection.create",confirm:true,user:$user,provider:$provider,connection:$connection,source:$source,authMethod:$authMethod,label:$label}')
      jpost "/api/v1/integrations" "$body" ;;
    manage)
      [ $# -eq 1 ] || die 'usage: mso integrations manage <metadata-JSON with action and confirm:true>'
      body=$(jq -ce 'if type=="object" and .confirm==true then .+{mode:"manage"} else error("explicit confirmation required") end' <<<"$1")
      data=$(jpost "/api/v1/integrations" "$body")
      # Hosted authorization links must not be emitted by non-interactive agent calls.
      if jq -e '.privateUrl' >/dev/null <<<"$data"; then
        if tty_ok; then jq . <<<"$data"; else jq 'del(.privateUrl)+{notice:"Authorization link available only in the private UI or interactive terminal"}' <<<"$data"; fi
      else printf '%s\n' "$data"; fi ;;
    verify|route)
      [ $# -eq 3 ] || die "usage: mso integrations $sub <user> <provider> <connection>"
      body=$(jq -nc --arg op "$sub" --arg user "$1" --arg provider "$2" --arg connection "$3" '{mode:"execute",operation:$op,user:$user,provider:$provider,connection:$connection}')
      jpost "/api/v1/integrations" "$body" ;;
    execute)
      [ $# -eq 1 ] || die 'usage: mso integrations execute <metadata-JSON with user, provider, connection, operation and confirm:true>'
      body=$(jq -ce 'if type=="object" then .+{mode:"execute"} else error("object required") end' <<<"$1")
      jpost "/api/v1/integrations" "$body" ;;
    *) die 'usage: mso integrations status|users|catalog|connections|which|request|resolve|create-user|create-connection|manage|setup|verify|route|execute' ;;
  esac
}
