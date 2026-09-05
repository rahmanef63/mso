#!/usr/bin/env bash
# Optional one-way local migration bridge from SI-Coder's public Integration Bundle v1.
# MSO remains standalone: this file is inert when SI-Coder is absent. Only metadata is
# auto-detected; direct credential values require the existing encrypted/manual transfer.
integration_sc_binary(){
  local c meta
  for c in "${MSO_SC_BIN-}" "$HOME/.local/bin/sc"; do
    [ -n "$c" ] && [ -x "$c" ] || continue
    meta=$("$c" version --json 2>/dev/null) || continue
    jq -e '.version and (.source|type=="string") and (.source|test("(^|/)si-coder-agent($|/)"))' >/dev/null 2>&1 <<<"$meta" || continue
    printf '%s' "$c"; return 0
  done
  return 1
}
integration_sc_bundle(){
  local bin dir out rc=0
  bin=$(integration_sc_binary) || return 1
  dir=$(mktemp -d "${TMPDIR:-/tmp}/mso-sc-migration.XXXXXX") || return 1
  chmod 700 "$dir"; out="$dir/sc.integration-bundle.json"
  "$bin" data export --out "$out" >/dev/null 2>&1 || rc=$?
  if [ "$rc" -eq 0 ]; then cat "$out"; fi
  [ ! -e "$out" ] || { : >"$out"; unlink "$out"; }
  rmdir "$dir" 2>/dev/null || true
  return "$rc"
}
integration_sc_probe(){
  local bundle users connections
  if ! bundle=$(integration_sc_bundle); then printf '%s' '{"available":false}'; return; fi
  users=$(jq '.users|length' <<<"$bundle") || { printf '%s' '{"available":false}'; return; }
  connections=$(jq '[.users[].connections[]]|length' <<<"$bundle")
  jq -nc --argjson users "$users" --argjson connections "$connections" '{available:true,producer:"si-coder",userCount:$users,connectionCount:$connections,mode:"metadata"}'
}
integration_sc_preview_document(){
  local bundle="$1" body
  body=$(jq -nc --argjson document "$bundle" '{action:"import",document:$document,policy:"skip"}')
  jpost "/api/v1/integrations/transfer" "$body"
}
integration_sc_preview(){ local bundle;bundle=$(integration_sc_bundle)||die "SI-Coder portable metadata is unavailable; expected ~/.local/bin/sc";integration_sc_preview_document "$bundle"; }
integration_sc_preview_text(){
  local p="$1"
  printf 'SI-Coder migration preview\n'
  printf '  users        %s new\n' "$(jq -r '.createUsers|length'<<<"$p")"
  printf '  connections  %s create · %s preserved/skipped\n' "$(jq -r '[.connections[]|select(.status=="create")]|length'<<<"$p")" "$(jq -r '[.connections[]|select(.status=="skip")]|length'<<<"$p")"
  printf '  warnings     %s\n' "$(jq -r '.warnings|length'<<<"$p")"
  jq -r '.connections[:24][]|"  "+(if .status=="create" then "＋" else "·" end)+" \(.user)/\(.provider)/\(.connection)" + (if .reason then " · "+.reason else "" end)' <<<"$p"
  local rest;rest=$(jq -r '(.connections|length)-24'<<<"$p");[ "$rest" -le 0 ]||printf '  … %s more\n' "$rest"
  printf '\nMetadata only: credential values are not copied. Existing MSO identities are preserved.\n'
}
integration_sc_apply_document(){
  local bundle="$1" preview="$2" body
  body=$(jq -nc --argjson document "$bundle" --arg confirm "$(jq -r .planId<<<"$preview")" --argjson accept "$(jq -r '(.warnings|length)>0'<<<"$preview")" '{action:"import",document:$document,policy:"skip",apply:true,confirm:$confirm,acceptWarnings:$accept}')
  jpost "/api/v1/integrations/transfer" "$body"
}
integration_sc_import_interactive(){
  local bundle preview ans applied
  bundle=$(integration_sc_bundle) || die "SI-Coder portable metadata is unavailable; expected ~/.local/bin/sc"
  preview=$(integration_sc_preview_document "$bundle") || return
  integration_sc_preview_text "$preview"
  if ! jq -e '.canApply==true' >/dev/null <<<"$preview"; then printf 'Import cannot be applied with the current conflicts.\n'; return 1; fi
  tty_line "Apply this create-only metadata import? [y/N]: " n; ans="${REPLY,,}"
  case "$ans" in y|yes) ;; *) printf 'cancelled\n'; return 0;; esac
  applied=$(integration_sc_apply_document "$bundle" "$preview") || return
  printf 'Imported %s named connection(s) from SI-Coder metadata.\n' "$(jq -r '.created//0'<<<"$applied")"
  printf 'Direct credentials still require private setup or an encrypted Integration Bundle. External OAuth/provider-MCP connections require reauthorization.\n'
}
integration_sc_import_cli(){
  local bundle preview ans applied
  bundle=$(integration_sc_bundle) || die "SI-Coder portable metadata is unavailable; expected ~/.local/bin/sc"
  preview=$(integration_sc_preview_document "$bundle") || return
  if ! tty_ok || [ ! -t 0 ] || [ ! -t 1 ]; then printf '%s\n' "$preview"; return; fi
  integration_sc_preview_text "$preview"
  if ! jq -e '.canApply==true' >/dev/null <<<"$preview"; then return 1; fi
  tty_line "Apply this create-only metadata import? [y/N]: " n; ans="${REPLY,,}"
  case "$ans" in y|yes) ;; *) printf 'cancelled\n'; return 0;; esac
  applied=$(integration_sc_apply_document "$bundle" "$preview") || return
  printf 'Imported %s named connection(s).\n' "$(jq -r '.created//0'<<<"$applied")"
}
