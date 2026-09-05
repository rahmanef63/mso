#!/usr/bin/env bash
# User-facing command usage + dispatch. Sourced by bin/mso.
# Print the header block verbatim — stops at the first non-comment line, so the
# help can never drift out of sync with the comment above.
usage() { awk 'NR>1 { if ($0 !~ /^#/) exit; sub(/^# ?/, ""); print }' "$0"; }

# Every verb the dispatch table implements, one per line, aliases split out. Read
# from the table itself so a new arm can never be missing from did-you-mean.
MSO_CLI_VERB_FILES=(
  "$ROOT/scripts/cli/commands-host.sh"
  "$ROOT/scripts/cli/commands-runtime.sh"
  "$ROOT/scripts/cli/commands-state.sh"
  "$ROOT/scripts/cli/commands-admin.sh"
)
verbs() {
  awk 'match($0, /^  [a-zA-Z|-]+\)/) {
         s = substr($0, 3, RLENGTH - 3); gsub(/\|/, "\n", s); print s
       }' "${MSO_CLI_VERB_FILES[@]}"
}

# One usage string per command group, used by BOTH `--help` and the error path —
# so the help you get when you ask cannot disagree with the help you get when
# you're wrong.
U_camoufox="camoufox status|start|stop|session"
U_gateway="gateway start [--config <cloudflared.yml> --tunnel <name|uuid>]|stop|status|url|doctor|install|domain show|set <https://host>|clear"
U_doctor="doctor [--fix]"
U_integrations="integrations transfer|status|users|catalog|connections [user] [provider]|which [folder]|request|resolve <user> <provider> [connection]|create-user <id> [label]|create-connection <user> <provider> <id> <source> <auth>|manage <JSON>|setup|verify <user> <provider> <connection>|hostinger-mail-orders|hostinger-mail-list|hostinger-mail-logs|execute <JSON>"
U_provider="provider list|show <id>|setup <provider> <user> <connection>|set <id>|rm <id>|doctor [id]|projects|zones"
U_model="model [current|list [provider]|set <provider> <model>|set <provider/model>|<model-or-ref>]"
U_agent="agent [--continue|-c|--resume|-r <latest|index|id|title>|--yolo|-yolo] | agent --oneshot <prompt> [--json] [--approve-scope read|write|exec]"
U_mapp="mapp list|show|logs|backups|jobs|job <id> <jobId>|pending <id>|install|update|power <id> <act>|cancel <id> <jobId>"
U_term="term open [cwd] [cols] [rows]|input <id> <text>|resize <id> <cols> <rows>|stream <id>|close <id>"
U_device="device list|pending|approve <id> [label] [--role viewer|operator|owner]|role <id> <role>|revoke <id>|revoke all --yes"
U_service="service status|start|stop|restart|logs [n]"
U_unit="unit logs <system|user> <unit> [limit]|start|stop|restart <system|user> <unit>"
U_reset="reset [--scope config|all] [--json] [--apply --confirm <preview-token>]"
U_uninstall="uninstall [--purge] [--remove-code] [--service name.service] [--json] [--apply --confirm <preview-token>]"
U_update="update [--rebuild] | status | log"
U_cockpit="cockpit [project] | cockpit show [project] | cockpit search <query…>"
U_threads="threads list|show <id>|save <json>|rm <id>"
U_agent_sessions="agent-sessions list [limit]|show <id>|create [title]"
U_agents="agents list [current-session-id]|send <source-session-id> <target> <message> [message|task]|inbox <session-id> [--all]"
U_a2a="a2a list|state|sessions|spawn <source-session> <objective> [title]|inbox <session>|discover <url>|add <url> [alias]|rm <target>|send <target> <message> [--wait]|stream <target> <message>|task <target> <taskId> [history]|cancel <target> <taskId>|handoff <target> <objective> [context] [--wait]|local sessions|local handoff <session> <objective>|local spawn <sourceSession> <objective> [title]|local inbox <session>|auth list [target]|auth add <target> [label] [bearer|api-key|oauth2]|auth use <target> <credentialId|none>|auth rm <credentialId>|inbound list|inbound create [label] [read|write|exec]|inbound rm <tokenId>"
U_memory="memory list|add <text>|rm <id>"
U_config="config show|set <json>|key <provider>|style <off|caveman|ponytail>|rm <provider>"
U_prefs="prefs show|set <json>"
U_models="models [status|list|add|auth <provider>|rm <provider>|catalog [provider]|test]"
U_skills="skills list|read <id>|search <query…>|available|info <id>|install <id…> [-y] [--force]|remove <id…> [-y]"
U_mcp="mcp list|activity [n]|service-token --label <label> --client-id <id> --scope <read|write|exec> --tools <name,name> [--constraints-json <json>]|revoke <id>|revoke all"
U_oauth="oauth <provider> start|poll   OAuth currently: openai (ChatGPT Codex)"
# Command families are sourced here so bin/mso remains only bootstrap + entrypoint.
# shellcheck source=commands-host.sh
source "$ROOT/scripts/cli/commands-host.sh"
# shellcheck source=commands-runtime.sh
source "$ROOT/scripts/cli/commands-runtime.sh"
# shellcheck source=commands-state.sh
source "$ROOT/scripts/cli/commands-state.sh"
# shellcheck source=commands-admin.sh
source "$ROOT/scripts/cli/commands-admin.sh"

mso_cli_unknown() {
  local cmd="$1" head3 near
  echo "mso: unknown command '$cmd'" >&2
  head3="${cmd:0:3}"
  near=$(verbs | while read -r v; do
    case "$v" in "$cmd"*|*"$cmd"*|"$head3"*) echo "  $v" ;; esac
  done)
  [ -n "$near" ] && { echo "did you mean:" >&2; echo "$near" >&2; }
  echo >&2; usage >&2; exit 1
}

mso_cli_main() {
  if [ $# -ge 2 ]; then
    case "$2" in
      -h|--help|help)
        eval "u=\${U_$1-}"
        [ -n "${u-}" ] && { echo "usage: mso $u"; exit 0; }
        usage | grep -E "^ +$1( |$)" || usage
        exit 0 ;;
    esac
  fi

  local cmd="${1:-agent}"
  maybe_update_notice "$cmd"
  shift || true
  if [ "$cmd" = agent ] || [ "$cmd" = chat ]; then set -- "${AGENT_START_ARGS[@]}" "$@"; fi

  case "$cmd" in
    version|--version|-V|-v|ls|cat|raw|share|usage|search|write|mkdir|rm|mv|cp|zip|upload|exec|stats|ps|units|unit|packages|cleanup|status|health|doctor)
      mso_cmd_host "$cmd" "$@" ;;
    agent|chat|model|setup|onboard|provider|providers|integrations|gateway|web|camoufox|apps|mapp|term)
      mso_cmd_runtime "$cmd" "$@" ;;
    ai|cockpit|threads|agent-sessions|agents|a2a|memory|config|prefs|models|skills|changelog|stock)
      mso_cmd_state "$cmd" "$@" ;;
    devices|device|approve|revoke|oauth|mcp|audit|whoami|login|logout|service|build|deploy|update|reset|uninstall|crud|api|completion)
      mso_cmd_admin "$cmd" "$@" ;;
    help|-h|--help) usage; exit 0 ;;
    *) mso_cli_unknown "$cmd" ;;
  esac
  echo
}
