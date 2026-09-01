#!/usr/bin/env bash
# MSO terminal-agent / infrastructure-provider CLI slice.
# This file is sourced by bin/mso after generic auth/HTTP/TTY helpers are defined.
# It deliberately owns no standalone entrypoint and no duplicate transport logic.

# Build the provider/key request from stdin so the secret never appears in jq/node argv.
provider_key_body() {
  node -e 'const fs=require("fs"); const a=fs.readFileSync(0).toString("utf8").split("\0"); process.stdout.write(JSON.stringify({provider:a[0]||"",apiKey:a[1]||""}));'
}

provider_key_body_unselected() {
  node -e 'const fs=require("fs"); const a=fs.readFileSync(0).toString("utf8").split("\0"); process.stdout.write(JSON.stringify({provider:a[0]||"",apiKey:a[1]||"",select:false}));'
}

custom_provider_body_unselected() {
  node -e '
const fs=require("fs");
const a=fs.readFileSync(0).toString("utf8").split("\0");
const models=(a[4]||"").split(/[\n,]+/).map(x=>x.trim()).filter(Boolean);
process.stdout.write(JSON.stringify({customProvider:{name:a[0]||"",baseURL:a[1]||"",protocol:a[2]||"openai",apiKey:a[3]||"",...(models.length?{models}:{})},select:false}));
'
}

onboard_infra() {
  local yes="$1" choice
  if [ "$yes" = 1 ]; then
    echo "  -- infrastructure providers skipped (-y never stores external credentials)"
    return
  fi
  echo
  echo "Infrastructure providers"
  echo "  MSO Agent can use these after you connect them. Secrets stay server-side and never enter model tool arguments."
  tty_line "Configure Dokploy now? [y/N]: " "n"; choice="${REPLY,,}"
  case "$choice" in y|yes) run_provider set dokploy ;; esac
  echo
  echo "DNS provider"
  echo "  0) Skip"
  echo "  1) Cloudflare (per-record writes only)"
  echo "  2) Hostinger (exact name/type RR-set updates; agent approval required)"
  tty_line "Choose [0]: " 0; choice="$REPLY"
  case "$choice" in 1) run_provider set cloudflare ;; 2) run_provider set hostinger ;; *) echo "  -- DNS provider skipped" ;; esac
}

ai_config_ready() {
  jq -e '. as $c | ($c.hasApiKey == true or any($c.providers[]?; .id == $c.provider and .kind == "oauth"))' >/dev/null 2>&1
}

ai_model_config() { jget "/api/config"; }

ai_provider_connected() {
  local provider="$1" cfg="${2:-}"
  [ -n "$cfg" ] || cfg=$(ai_model_config)
  jq -e --arg p "$provider" '
    (.provider == $p and .hasApiKey == true) or
    any(.providers[]?; .id == $p and (.hasKey == true or .kind == "oauth" or .kind == "custom"))
  ' <<<"$cfg" >/dev/null 2>&1
}

print_ai_providers() {
  local cfg="$1"
  echo "AI providers/auth"
  printf '  active  %s/%s\n' "$(jq -r '.provider // "—"' <<<"$cfg")" "$(jq -r '.model // "—"' <<<"$cfg")"
  if ! jq -e '.providers | length > 0' <<<"$cfg" >/dev/null 2>&1; then
    echo "  · no stored provider credentials yet"
  else
    jq -r --arg active "$(jq -r '.provider // ""' <<<"$cfg")" '.providers[] | [if .id == $active then "●" else "✓" end, .id, .kind, (.masked // (if .hasKey then "configured" else "" end))] | @tsv' <<<"$cfg" |
      while IFS=$'\t' read -r mark id kind auth; do printf '  %s %-18s %-8s %s\n' "$mark" "$id" "$kind" "$auth"; done
  fi
  if [ "$(jq -r '.hasApiKey // false' <<<"$cfg")" = true ] && ! jq -e --arg p "$(jq -r '.provider // ""' <<<"$cfg")" 'any(.providers[]?; .id==$p)' <<<"$cfg" >/dev/null 2>&1; then
    echo "  ● $(jq -r '.provider' <<<"$cfg")    env credential (active)"
  fi
}

ai_model_catalog() {
  local provider="$1" cfg="${2:-}"
  [ -n "$cfg" ] || cfg=$(ai_model_config)
  local data
  data=$(jget "/api/models?provider=$(enc "$provider")")
  # Custom providers may declare their own IDs even though models.dev has no slug for them.
  if ! jq -e '.models | length > 0' <<<"$data" >/dev/null 2>&1; then
    jq -nc --arg p "$provider" --argjson c "$cfg" '{models:[($c.providers[]? | select(.id==$p) | .models[]?) | {provider:$p,id:.,ref:($p+"/"+.),name:.}]}'
  else
    printf '%s\n' "$data"
  fi
}

print_model_catalog() {
  local provider="$1" cfg="$2" data current
  data=$(ai_model_catalog "$provider" "$cfg")
  current="$(jq -r '.model // ""' <<<"$cfg")"
  if ! jq -e '.models | length > 0' <<<"$data" >/dev/null 2>&1; then
    echo "No discoverable models for $provider. Check provider auth/network or declare custom models."
    return 1
  fi
  printf '%-2s %-34s %-10s %-8s %-8s %s\n' '' 'MODEL' 'CONTEXT' 'TOOLS' 'REASON' 'NAME'
  jq -r --arg current "$current" '.models[] | [if .id==$current then "●" else " " end,.id,((.context // 0)|tostring),(if .tools then "yes" else "—" end),(if .reasoning then "yes" else "—" end),(.name // .id)] | @tsv' <<<"$data" |
    while IFS=$'\t' read -r mark id context tools reasoning name; do
      [ "$context" = 0 ] && context="—"
      printf '%-2s %-34s %-10s %-8s %-8s %s\n' "$mark" "${id:0:34}" "$context" "$tools" "$reasoning" "${name:0:45}"
    done
}

configure_oauth_provider() {
  local provider="$1" response code url interval poll
  [ "$provider" = "openai-codex" ] || die "OAuth provider not supported yet: $provider"
  response=$(jpost "/api/oauth/openai" '{"action":"start","select":false}')
  code=$(jq -r '.userCode // empty' <<<"$response"); url=$(jq -r '.verificationUrl // empty' <<<"$response"); interval=$(jq -r '.intervalMs // 5000' <<<"$response")
  [ -n "$code" ] && [ -n "$url" ] || die "OpenAI OAuth did not return a device code"
  echo "Open this URL in any browser: $url"
  echo "Enter code: $code"
  echo "Waiting for authorization (active model will NOT change)..."
  while true; do
    sleep "$(( interval / 1000 > 2 ? interval / 1000 : 3 ))"
    poll=$(jpost "/api/oauth/openai" '{"action":"poll","select":false}')
    if [ "$(jq -r '.ok // false' <<<"$poll")" = true ]; then
      echo "  ✓ connected $(jq -r '.slug' <<<"$poll"); model selection unchanged"
      return
    fi
    [ "$(jq -r '.pending // false' <<<"$poll")" = true ] || die "OpenAI OAuth failed: $poll"
    tty_print "."
  done
}

configure_ai_provider() {
  local provider="$1" key body name base protocol models
  case "$provider" in
    chatgpt|codex) provider=openai-codex ;;
  esac
  case "$provider" in
    openai-codex) configure_oauth_provider "$provider"; return ;;
    custom)
      tty_ok || die "custom provider setup needs an interactive terminal"
      tty_line "Provider name: " ""; name="$REPLY"; [ -n "$name" ] || die "provider name required"
      tty_line "Base URL (https://.../v1): " ""; base="$REPLY"; [ -n "$base" ] || die "base URL required"
      tty_line "Protocol [openai|anthropic] [openai]: " "openai"; protocol="$REPLY"
      case "$protocol" in openai|anthropic) ;; *) die "protocol must be openai or anthropic" ;; esac
      tty_line "Models (comma/newline IDs; optional): " ""; models="$REPLY"
      tty_secret "API key: "; key="$REPLY"; [ -n "$key" ] || die "empty API key"
      body=$(printf '%s\0%s\0%s\0%s\0%s' "$name" "$base" "$protocol" "$key" "$models" | custom_provider_body_unselected)
      secret_post "/api/config" "$body" >/dev/null
      unset key body REPLY
      echo "  ✓ custom provider configured; active model unchanged"
      return ;;
    anthropic|openai|openrouter|google|groq|xai|deepseek|mistral) ;;
    *) die "provider must be: openai-codex anthropic openai openrouter google groq xai deepseek mistral custom" ;;
  esac
  tty_ok || die "provider setup needs an interactive terminal"
  tty_secret "Paste $provider API key: "; key="$REPLY"; [ -n "$key" ] || die "empty API key"
  body=$(printf '%s\0%s' "$provider" "$key" | provider_key_body_unselected)
  secret_post "/api/config" "$body" >/dev/null
  unset key body REPLY
  echo "  ✓ $provider configured; active model unchanged"
}

select_model_ref() {
  local requested="$1" cfg provider model candidate data
  cfg=$(ai_model_config)
  provider=$(jq -r '.provider // ""' <<<"$cfg"); model="$requested"
  # Model IDs themselves may contain slashes (notably OpenRouter). Prefer an exact
  # match in the current provider before treating the first segment as a provider.
  if [ -n "$provider" ] && ai_provider_connected "$provider" "$cfg" && jq -e --arg id "$requested" 'any(.models[]?; .id==$id)' <<<"$(ai_model_catalog "$provider" "$cfg")" >/dev/null 2>&1; then
    model="$requested"
  else
    candidate="${requested%%/*}"
    if [ "$candidate" != "$requested" ] && ai_provider_connected "$candidate" "$cfg"; then
      provider="$candidate"; model="${requested#*/}"
    fi
  fi
  [ -n "$provider" ] || die "no provider selected; run: mso models add <provider>"
  ai_provider_connected "$provider" "$cfg" || die "$provider is not connected; run: mso models add $provider"
  data=$(ai_model_catalog "$provider" "$cfg")
  if ! jq -e --arg id "$model" 'any(.models[]?; .id==$id)' <<<"$data" >/dev/null 2>&1; then
    echo "model '$model' is not in the available catalog for $provider" >&2
    print_model_catalog "$provider" "$cfg" >&2 || true
    return 2
  fi
  jpost "/api/config" "$(jq -nc --arg p "$provider" --arg m "$model" '{provider:$p,model:$m}')" >/dev/null
  echo "  ✓ active model: $provider/$model"
}

run_model_setup() {
  local sub="${1:-}" cfg provider data choice count selected
  ensure_local_cli_device; ensure_onboard_runtime; jget "/api/auth/me" >/dev/null
  cfg=$(ai_model_config)
  case "$sub" in
    current|show)
      printf '%s/%s\n' "$(jq -r '.provider // "—"' <<<"$cfg")" "$(jq -r '.model // "—"' <<<"$cfg")"; return ;;
    list)
      provider="${2:-$(jq -r '.provider // ""' <<<"$cfg")}"; [ -n "$provider" ] || die "no active provider"
      ai_provider_connected "$provider" "$cfg" || die "$provider is not connected; run: mso models add $provider"
      print_model_catalog "$provider" "$cfg"; return ;;
    set)
      [ -n "${2-}" ] || die "usage: mso model set <provider> <model>  |  mso model set <provider/model>"
      if [ -n "${3-}" ]; then select_model_ref "$2/$3"; else select_model_ref "$2"; fi
      return ;;
    '') ;;
    *) select_model_ref "$sub"; return ;;
  esac
  tty_ok || die "mso model without a ref needs an interactive terminal; use: mso model list"
  echo "Active model: $(jq -r '.provider+"/"+.model' <<<"$cfg")"
  echo "Connected providers:"
  mapfile -t providers < <({ jq -r '.providers[]?.id' <<<"$cfg"; if [ "$(jq -r '.hasApiKey // false' <<<"$cfg")" = true ]; then jq -r '.provider' <<<"$cfg"; fi; } | awk 'NF && !seen[$0]++')
  [ "${#providers[@]}" -gt 0 ] || die "no AI provider connected; run: mso models"
  for i in "${!providers[@]}"; do printf '  %d) %s%s\n' "$((i+1))" "${providers[$i]}" "$([ "${providers[$i]}" = "$(jq -r '.provider' <<<"$cfg")" ] && printf '  [active]' || true)"; done
  tty_line "Provider [1]: " 1; choice="$REPLY"; [[ "$choice" =~ ^[0-9]+$ ]] || die "choose a provider number"
  selected=$((choice-1)); [ "$selected" -ge 0 ] && [ "$selected" -lt "${#providers[@]}" ] || die "provider choice out of range"
  provider="${providers[$selected]}"
  data=$(ai_model_catalog "$provider" "$cfg"); count=$(jq '.models|length' <<<"$data")
  [ "$count" -gt 0 ] || die "no discoverable models for $provider"
  echo; print_model_catalog "$provider" "$cfg"
  echo
  mapfile -t model_ids < <(jq -r '.models[].id' <<<"$data")
  for i in "${!model_ids[@]}"; do printf '  %d) %s\n' "$((i+1))" "${model_ids[$i]}"; done
  tty_line "Model [1]: " 1; choice="$REPLY"; [[ "$choice" =~ ^[0-9]+$ ]] || die "choose a model number"
  selected=$((choice-1)); [ "$selected" -ge 0 ] && [ "$selected" -lt "${#model_ids[@]}" ] || die "model choice out of range"
  select_model_ref "$provider/${model_ids[$selected]}"
}

run_models() {
  local sub="${1:-}" cfg provider choice
  ensure_local_cli_device; ensure_onboard_runtime; jget "/api/auth/me" >/dev/null
  cfg=$(ai_model_config)
  case "$sub" in
    status|list) print_ai_providers "$cfg" ;;
    add|auth)
      provider="${2-}"; [ -n "$provider" ] || die "usage: mso models $sub <provider>"
      configure_ai_provider "$provider" ;;
    rm|remove)
      provider="${2-}"; [ -n "$provider" ] || die "usage: mso models rm <provider>"
      jdel "/api/config?provider=$(enc "$provider")" >/dev/null; echo "  ✓ removed AI provider: $provider" ;;
    catalog)
      provider="${2:-$(jq -r '.provider // ""' <<<"$cfg")}"; [ -n "$provider" ] || die "provider required"
      print_model_catalog "$provider" "$cfg" ;;
    test) jpost "/api/models/test" ;;
    '')
      tty_ok || { print_ai_providers "$cfg"; return; }
      print_ai_providers "$cfg"; echo
      echo "  0) Done"
      echo "  1) Add/auth provider"
      echo "  2) Remove provider"
      echo "  3) Browse model catalog"
      tty_line "Choose [0]: " 0; choice="$REPLY"
      case "$choice" in
        1) tty_line "Provider [openai-codex|anthropic|openai|openrouter|google|groq|xai|deepseek|mistral|custom]: " "openai-codex"; configure_ai_provider "$REPLY" ;;
        2) tty_line "Provider id: " ""; [ -n "$REPLY" ] && run_models rm "$REPLY" ;;
        3) tty_line "Provider [$(jq -r '.provider // ""' <<<"$cfg")]: " "$(jq -r '.provider // ""' <<<"$cfg")"; print_model_catalog "$REPLY" "$cfg" ;;
        *) : ;;
      esac ;;
    *) die "usage: mso models [status|list|add|auth <provider>|rm <provider>|catalog [provider]|test]" ;;
  esac
}

provider_metadata() { jget "/api/v1/infra/providers"; }

run_provider() {
  local sub="${1:-list}" id="${2-}" data row fields key label secret required description existing value body
  local -a pairs=()
  case "$sub" in
    list)
      provider_metadata | jq -r '.providers[] | "\(if .configured then "✓" else "·" end) \(.id)\t\(if .configured then "configured" else "missing: " + (.missing|join(", ")) end)\t\(.description)"' ;;
    show)
      # U_provider is the shared usage string defined by bin/mso before this slice is sourced.
      # shellcheck disable=SC2154
      [ -n "$id" ] || die "usage: mso $U_provider"
      provider_metadata | jq --arg id "$id" '.providers[] | select(.id==$id)' ;;
    projects|dokploy-projects)
      jget "/api/v1/infra/dokploy/projects" | jq -r '.projects[] | "\(.projectId)\t\(.name)"' ;;
    zones|cloudflare-zones)
      jget "/api/v1/infra/cloudflare/zones" | jq -r '.zones[] | "\(.id)\t\(.name)"' ;;
    doctor)
      id="${2-}"
      if [ -n "$id" ]; then body=$(jq -nc --arg id "$id" '{id:$id}'); else body='{}'; fi
      jpost "/api/v1/infra/providers/doctor" "$body" | jq -r '.results[] | "\(if .ok == true then "✓" elif .ok == false then "✗" else "·" end) \(.id) — \(.detail)"' ;;
    rm|remove)
      # shellcheck disable=SC2154
      [ -n "$id" ] || die "usage: mso $U_provider"
      jdel "/api/v1/infra/providers?id=$(enc "$id")" >/dev/null
      echo "removed infrastructure provider: $id" ;;
    set)
      # shellcheck disable=SC2154
      [ -n "$id" ] || die "usage: mso $U_provider"
      tty_ok || die "provider setup needs a terminal because API tokens are entered with hidden input"
      data=$(provider_metadata)
      row=$(jq -c --arg id "$id" '.providers[] | select(.id==$id)' <<<"$data")
      [ -n "$row" ] || die "unknown provider '$id' (expected dokploy, cloudflare, hostinger)"
      echo "$(jq -r '.title + " — " + .description' <<<"$row")"
      pairs=()
      while IFS=$'\t' read -r key label secret required description existing; do
        [ -n "$key" ] || continue
        echo
        if [ "$required" = true ]; then echo "  $label  (required)"; else echo "  $label  (optional)"; fi
        [ -z "$description" ] || echo "    $description"
        if [ "$secret" = true ]; then
          if [ -n "$existing" ]; then tty_secret "    new value (blank = keep ${existing}): "; value="$REPLY"
          else tty_secret "    value: "; value="$REPLY"; fi
        else
          tty_line "    value${existing:+ [$existing]}: " "$existing"; value="$REPLY"
        fi
        if [ -z "$value" ] && [ "$required" = true ] && [ -z "$existing" ]; then die "$key is required"; fi
        [ -z "$value" ] || pairs+=("$key" "$value")
        unset value REPLY
      done < <(jq -r '.fields[] as $f | [$f.key,$f.label,($f.secret|tostring),($f.required|tostring),($f.description // ""),(.values[$f.key] // "")] | @tsv' <<<"$row")
      # Values stay in this shell's memory and flow to Node over stdin; they never
      # appear in process argv, environment variables, or a temporary credential file.
      body=$(printf '%s\0' "${pairs[@]}" | node -e '
const fs = require("fs");
const id = process.argv[1];
const parts = fs.readFileSync(0).toString("utf8").split("\0");
const values = {};
for (let i = 0; i + 1 < parts.length; i += 2) if (parts[i]) values[parts[i]] = parts[i + 1];
process.stdout.write(JSON.stringify({ id, values }));
' "$id")
      secret_post "/api/v1/infra/providers" "$body" >/dev/null
      unset body
      echo "  ✓ $id configured"
      jpost "/api/v1/infra/providers/doctor" "$(jq -nc --arg id "$id" '{id:$id}')" | jq -r '.results[] | "  \(if .ok == true then "✓" elif .ok == false then "✗" else "·" end) \(.detail)"' ;;
    *)
      # shellcheck disable=SC2154
      die "usage: mso $U_provider" ;;
  esac
}

run_agent() {
  local cfg
  tty_ok || die "interactive agent needs a terminal; use: mso ai <prompt> for a one-shot request"
  ensure_local_cli_device
  ensure_onboard_runtime
  jget "/api/auth/me" >/dev/null
  cfg=$(jget "/api/config")
  if ! printf '%s' "$cfg" | ai_config_ready; then
    if jq -e '.providers | length > 0' <<<"$cfg" >/dev/null 2>&1; then
      echo "MSO Agent has connected provider credentials, but the active model is not usable yet."
      run_model_setup
    else
      echo "MSO Agent needs an AI provider/auth connection first."
      run_models
      cfg=$(jget "/api/config")
      jq -e '.providers | length > 0' <<<"$cfg" >/dev/null 2>&1 || die "no AI provider connected; run: mso models add <provider>"
      run_model_setup
    fi
    cfg=$(jget "/api/config")
    printf '%s' "$cfg" | ai_config_ready || die "active model is not usable; run: mso models list && mso model"
  fi
  MSO_AGENT_BASE="$B" MSO_AGENT_ORIGIN="$B" MSO_AGENT_JAR="$JAR" \
    MSO_AGENT_CLI="$ROOT/bin/mso" MSO_AGENT_VERSION="$VERSION" \
    node "$ROOT/scripts/mso-agent.mjs" "$@"
}
