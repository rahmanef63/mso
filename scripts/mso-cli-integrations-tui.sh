#!/usr/bin/env bash
# MSO-native Finder column browser for Integrations. Presentation state is ephemeral;
# all reads and confirmed mutations still use the same owner API as CLI/MCP/browser.
# shellcheck source=mso-cli-integrations-tui-remote.sh
source "$ROOT/scripts/mso-cli-integrations-tui-remote.sh"
integration_tui_slug(){ printf '%s' "$1"|tr '[:upper:]' '[:lower:]'|sed -E 's/[^a-z0-9._-]+/-/g;s/^-+//;s/-+$//'|cut -c1-64; }
integration_tui_snapshot(){ local u="${1-}" q=view=snapshot;[ -n "$u" ]&&q="$q&user=$(enc "$u")";jget "/api/v1/integrations?$q"; }
integration_tui_manage(){ jpost "/api/v1/integrations" "$1"; }
integration_tui_execute(){ local u="$1" p="$2" c="$3" op="$4" args="${5-}" confirm="${6:-false}" body;[ -n "$args" ]||args='{}';body=$(jq -nc --arg u "$u" --arg p "$p" --arg c "$c" --arg op "$op" --argjson a "$args" --argjson x "$confirm" '{mode:"execute",user:$u,provider:$p,connection:$c,operation:$op,arguments:$a}+(if $x then {confirm:true}else{}end)');jpost "/api/v1/integrations" "$body"; }
integration_alt_on(){ printf '\033[?1049h\033[?25l\033[H\033[2J' > /dev/tty; }
integration_alt_off(){ printf '\033[0m\033[?25h\033[?1049l' > /dev/tty 2>/dev/null||true; }
integration_stack_key(){ jq -r 'join("/")' <<<"$F_STACK"; }
integration_cached(){ local store="$1" key="$2";jq -r --arg k "$key" '.[$k]//""'<<<"$store"; }
integration_cache_event(){ local key="$1" event="$2" selected query;selected=$(jq -r '.selectedId//""'<<<"$event");query=$(jq -r '.query//""'<<<"$event");[ -n "$selected" ]&&F_SELECTED=$(jq --arg k "$key" --arg v "$selected" '.+{($k):$v}'<<<"$F_SELECTED");F_QUERIES=$(jq --arg k "$key" --arg v "$query" '.+{($k):$v}'<<<"$F_QUERIES"); }
integration_finder_event(){ local snap="$1" stack="$2" activity="$3" initial="$4" query="$5" file rc safe;file=$(mktemp "${TMPDIR:-/tmp}/mso-integrations-finder.XXXXXX");chmod 600 "$file";safe=$(jq 'walk(if type=="object" then del(.value,.values,.secretValue,.token,.tokenValue,.password,.passphrase,.apiKey,.apiKeyValue,.privateUrl,.setupToken) else . end)'<<<"$snap");jq -n --argjson snapshot "$safe" --argjson stack "$stack" --argjson activity "$activity" --arg initialId "$initial" --arg query "$query" '{snapshot:$snapshot,stack:$stack,activity:$activity,initialId:$initialId,query:$query}' >"$file";node "$ROOT/scripts/mso-integrations-finder.mjs" "$file";rc=$?;rm -f "$file";return $rc; }
integration_tui_dispatch(){ local id="$1" snap="$2" value;case "$id" in
 action:quit) return 90;; action:inspect-auth:*) integration_activity "✓ Authentication metadata selected" "No credential value is loaded into the Finder frame.";;
 action:current) local out;out=$(jget "/api/v1/integrations?view=which&cwd=$(enc "$PWD")");integration_activity "✓ Current folder resolved" "user: $(jq -r '.user//"none"'<<<"$out")" "resolution: $(jq -r '.resolution//"none"'<<<"$out")";;
 action:transfer:metadata|action:transfer:encrypted|action:transfer:import) integration_prompt_mode;run_integrations transfer;integration_wait;integration_activity "✓ Opened private Import / export JSON manager" "Passphrases and direct credentials stay outside Finder state.";;
 action:transfer:schema) integration_activity "✓ Integration Bundle v1" "schema: schemas/integration-bundle-v1.schema.json" "metadata JSON excludes credential values by default";;
 action:user-add) integration_action_user_add;;action:user-default) integration_action_user_default;;action:user-bind) integration_action_user_bind;;action:user-rename) integration_action_user_rename;;action:user-duplicate) integration_action_user_duplicate;;action:user-delete) integration_action_user_delete;;
 action:create-connection) integration_action_create_connection;;action:setup) integration_action_setup;;action:authorize) integration_action_authorize;;action:verify) integration_action_verify;;action:route) integration_action_route;;action:connection-default) integration_action_connection_default;;action:connection-rename) integration_action_connection_rename;;action:connection-delete) integration_action_connection_delete;;
 action:mail-orders) integration_action_mail orders orders;;action:mail-resource:*) value="${id#action:mail-resource:}";integration_action_mail resource "$value";;action:mail-log:*) value="${id#action:mail-log:}";integration_action_mail log "$value";;
 *) integration_activity "⚠ Unsupported Finder action: $id";; esac; }
integration_shortcut(){ local id="$1" snap="$2" u p c source idx;u=$(integration_context user:);p=$(integration_context provider:);c=$(integration_context connection:);case "$id" in
 help) integration_activity "MSO Integrations shortcuts" "↑↓ move · ←→ columns · Enter open/run · / filter" "V verify · R route · S setup · D default · N new" "1–4 sections · E export · I import · Ctrl-D quit";;
 export) F_STACK='["transfer"]';integration_tui_dispatch action:transfer:metadata "$snap";; import) F_STACK='["transfer"]';integration_tui_dispatch action:transfer:import "$snap";;
 new) [ -n "$u" ]&&[ -n "$p" ]||{ integration_activity "⚠ Select a credential user and provider first";return;};idx=$(jq '[to_entries[]|select(.value|startswith("provider:"))]|last.key'<<<"$F_STACK");F_STACK=$(jq --argjson i "$idx" '.[0:$i+1]+["new"]'<<<"$F_STACK");;
 verify) integration_tui_dispatch action:verify "$snap";; route) integration_tui_dispatch action:route "$snap";;
 setup) source=$(jq -r --arg u "$u" --arg p "$p" --arg c "$c" '.connections[]?|select(.user==$u and .provider==$p and .id==$c)|.source'<<<"$snap");[ "$source" = direct ]&&integration_tui_dispatch action:setup "$snap"||integration_activity "⚠ Secure local setup is available only for direct connections";;
 default) [ -n "$c" ]&&integration_tui_dispatch action:connection-default "$snap"||integration_tui_dispatch action:user-default "$snap";;
 esac; }
integrations_tui(){
  tty_ok||{ jget "/api/v1/integrations?view=snapshot";return; }
  F_STACK='[]';F_ACTIVITY='[]';F_SELECTED='{}';F_QUERIES='{}';local snap event type id rc key initial query
  integration_alt_on;trap 'integration_alt_off' EXIT INT TERM
  while true;do
    snap=$(integration_tui_snapshot "$(integration_context user:)");key=$(integration_stack_key);initial=$(integration_cached "$F_SELECTED" "$key");query=$(integration_cached "$F_QUERIES" "$key")
    if ! event=$(integration_finder_event "$snap" "$F_STACK" "$F_ACTIVITY" "$initial" "$query");then rc=$?;[ "$rc" -eq 130 ]&&break;integration_activity "✕ Finder renderer unavailable";continue;fi
    integration_cache_event "$key" "$event";type=$(jq -r '.type//"noop"'<<<"$event");id=$(jq -r '.id//.selectedId//""'<<<"$event");F_ACTIVITY='[]'
    case "$type" in
      quit) break;; back) [ "$(jq length<<<"$F_STACK")" -gt 0 ]&&F_STACK=$(jq '.[0:-1]'<<<"$F_STACK");; noop) :;;
      section) F_STACK=$(jq -nc --arg id "$id" '[$id]');; open) [ -n "$id" ]&&F_STACK=$(jq --arg id "$id" '.+[$id]'<<<"$F_STACK");;
      shortcut) integration_shortcut "$id" "$snap";; select) if ! integration_tui_dispatch "$id" "$snap";then rc=$?;[ "$rc" -eq 90 ]&&break;fi;;
    esac
  done
  integration_alt_off;trap - EXIT INT TERM
}
