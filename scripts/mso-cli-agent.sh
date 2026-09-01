#!/usr/bin/env bash
# MSO terminal-agent / infrastructure-provider CLI slice.
# This file is sourced by bin/mso after generic auth/HTTP/TTY helpers are defined.
# It deliberately owns no standalone entrypoint and no duplicate transport logic.

# Build the provider/key request from stdin so the secret never appears in jq/node argv.
provider_key_body() {
  node -e 'const fs=require("fs"); const a=fs.readFileSync(0).toString("utf8").split("\0"); process.stdout.write(JSON.stringify({provider:a[0]||"",apiKey:a[1]||""}));'
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

run_model_setup() {
  ensure_local_cli_device
  ensure_onboard_runtime
  jget "/api/auth/me" >/dev/null
  tty_ok || die "mso model needs an interactive terminal"
  onboard_ai 0
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
    echo "MSO Agent needs an AI provider first."
    onboard_ai 0
    cfg=$(jget "/api/config")
    printf '%s' "$cfg" | ai_config_ready || die "no AI provider connected; run `mso model` when ready"
  fi
  MSO_AGENT_BASE="$B" MSO_AGENT_ORIGIN="$B" MSO_AGENT_JAR="$JAR" \
    MSO_AGENT_CLI="$ROOT/bin/mso" MSO_AGENT_VERSION="$VERSION" \
    node "$ROOT/scripts/mso-agent.mjs" "$@"
}
