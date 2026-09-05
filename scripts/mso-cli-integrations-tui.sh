#!/usr/bin/env bash
# Finder-style multi-column native Integrations navigator. UI state is ephemeral;
# every read/write still uses the same owner API as CLI/MCP/browser.
# shellcheck source=mso-cli-integrations-tui-remote.sh
source "$ROOT/scripts/mso-cli-integrations-tui-remote.sh"
integration_tui_slug(){ printf '%s' "$1"|tr '[:upper:]' '[:lower:]'|sed -E 's/[^a-z0-9._-]+/-/g;s/^-+//;s/-+$//'|cut -c1-64; }
integration_tui_snapshot(){ local u="${1-}" q=view=snapshot;[ -n "$u" ]&&q="$q&user=$(enc "$u")";jget "/api/v1/integrations?$q"; }
integration_tui_manage(){ jpost "/api/v1/integrations" "$1"; }
integration_tui_execute(){ local u="$1" p="$2" c="$3" op="$4" args="${5:-{}}" confirm="${6:-false}" body;body=$(jq -nc --arg u "$u" --arg p "$p" --arg c "$c" --arg op "$op" --argjson a "$args" --argjson x "$confirm" '{mode:"execute",user:$u,provider:$p,connection:$c,operation:$op,arguments:$a}+(if $x then {confirm:true}else{}end)');jpost "/api/v1/integrations" "$body"; }
integration_alt_on(){ printf '\033[?1049h\033[?25l\033[H\033[2J' > /dev/tty; }
integration_alt_off(){ printf '\033[0m\033[?25h\033[?1049l' > /dev/tty 2>/dev/null||true; }
integration_finder_event(){ local snap="$1" stack="$2" activity="$3" file rc;file=$(mktemp "${TMPDIR:-/tmp}/mso-integrations-finder.XXXXXX");chmod 600 "$file";jq -n --argjson snapshot "$snap" --argjson stack "$stack" --argjson activity "$activity" '{snapshot:$snapshot,stack:$stack,activity:$activity}' >"$file";node "$ROOT/scripts/mso-integrations-finder.mjs" "$file";rc=$?;rm -f "$file";return $rc; }
integration_tui_dispatch(){ local id="$1" snap="$2" kind value root out;case "$id" in
 action:quit) return 90;;
 action:noop) integration_activity "Select a source/auth method to inspect its metadata";;
 action:current) out=$(jget "/api/v1/integrations?view=which&cwd=$(enc "$PWD")");integration_activity "current user: $(jq -r '.user//"none"'<<<"$out")" "resolution: $(jq -r '.resolution//"none"'<<<"$out")";;
 action:transfer) integration_prompt_mode;run_integrations transfer;integration_wait;integration_activity "Opened Import / export JSON";;
 action:user-add) integration_action_user_add;;action:user-default) integration_action_user_default;;action:user-bind) integration_action_user_bind;;action:user-rename) integration_action_user_rename;;action:user-duplicate) integration_action_user_duplicate;;action:user-delete) integration_action_user_delete;;
 action:create-connection) integration_action_create_connection;;action:setup) integration_action_setup;;action:authorize) integration_action_authorize;;action:verify) integration_action_verify;;action:route) integration_action_route;;action:connection-default) integration_action_connection_default;;action:connection-rename) integration_action_connection_rename;;action:connection-delete) integration_action_connection_delete;;
 action:mail-orders) integration_action_mail orders orders;;
 action:mail-resource:*) value="${id#action:mail-resource:}";integration_action_mail resource "$value";;
 action:mail-log:*) value="${id#action:mail-log:}";integration_action_mail log "$value";;
 *) integration_activity "Unsupported Finder action: $id";;
 esac; }
integrations_tui(){
  tty_ok||{ jget "/api/v1/integrations?view=snapshot";return; }
  F_STACK='[]';F_ACTIVITY='[]';local snap event type id rc
  integration_alt_on;trap 'integration_alt_off' EXIT INT TERM
  while true;do
    snap=$(integration_tui_snapshot "$(integration_context user:)")
    if ! event=$(integration_finder_event "$snap" "$F_STACK" "$F_ACTIVITY");then rc=$?;[ "$rc" -eq 130 ]&&break;integration_activity "Finder renderer unavailable";continue;fi
    type=$(jq -r '.type//"noop"'<<<"$event");id=$(jq -r '.id//.selectedId//""'<<<"$event");F_ACTIVITY='[]'
    case "$type" in
      quit) break;;
      back) [ "$(jq length<<<"$F_STACK")" -gt 0 ]&&F_STACK=$(jq '.[0:-1]'<<<"$F_STACK");;
      noop) :;;
      open) [ -n "$id" ]&&F_STACK=$(jq --arg id "$id" '.+[$id]'<<<"$F_STACK");;
      select) if ! integration_tui_dispatch "$id" "$snap";then rc=$?;[ "$rc" -eq 90 ]&&break;fi;;
    esac
  done
  integration_alt_off;trap - EXIT INT TERM
}
