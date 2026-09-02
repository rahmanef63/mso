#!/usr/bin/env bash
# TTY and guided onboarding helpers. Sourced by scripts/cli/runtime.sh.
tty_ok() { [ -r /dev/tty ] && [ -w /dev/tty ]; }
tty_print() { if tty_ok; then printf '%s' "$*" > /dev/tty; else printf '%s' "$*"; fi; }
tty_line() {
  local prompt="$1" default="${2-}" value=""
  if ! tty_ok; then REPLY="$default"; return; fi
  tty_print "$prompt"
  IFS= read -r value < /dev/tty || true
  REPLY="${value:-$default}"
}
tty_secret() {
  local prompt="$1" value=""
  tty_ok || die "a terminal is required to enter a secret; run this command interactively"
  tty_print "$prompt"
  stty -echo < /dev/tty
  IFS= read -r value < /dev/tty || true
  stty echo < /dev/tty
  tty_print $'\n'
  REPLY="$value"
}

ensure_local_cli_device() {
  local d; d=$(cli_device)
  case "$B" in
    http://127.0.0.1:*|http://localhost:*|http://[::1]:*) ;;
    *) return 0 ;;
  esac
  if ! dev_script --is-approved "$d" >/dev/null 2>&1; then
    dev_script "$d" "mso cli" >/dev/null
    [ "${MSO_CLI_QUIET:-0}" = "1" ] || echo "  ✓ approved this local CLI device"
  fi
}

ensure_onboard_runtime() {
  case "$B" in
    http://127.*:*|http://localhost:*|http://\[::1\]:*)
      MSO_GATEWAY_ROOT="$ROOT" MSO_GATEWAY_ENV="$ENVF" MSO_GATEWAY_LOCAL_URL="$B" \
        "$ROOT/scripts/mso-gateway" local-start >/dev/null \
        || die "local MSO runtime is not ready. Run: mso update ; then: mso web"
      [ "${MSO_CLI_QUIET:-0}" = "1" ] || echo "  ✓ verified local MSO runtime at $B" ;;
    *) return 0 ;;
  esac
}

onboard_ai() {
  local yes="$1" choice provider key body response interval code url poll
  if [ "$yes" = 1 ]; then
    echo "  -- AI provider skipped (-y keeps external accounts unconfigured)"
    return
  fi
  echo
  echo "AI for Alfa"
  echo "  0) Skip for now"
  echo "  1) OpenAI ChatGPT OAuth (Codex consumer backend; no API key)"
  echo "  2) Anthropic API key"
  echo "  3) OpenAI Platform API key"
  echo "  4) OpenRouter API key"
  echo "  5) Google Gemini API key"
  echo "  6) Groq API key"
  echo "  7) xAI API key"
  echo "  8) DeepSeek API key"
  echo "  9) Mistral API key"
  tty_line "Choose [0]: " 0; choice="$REPLY"
  case "$choice" in
    0|'') echo "  -- skipped"; return ;;
    1)
      response=$(jpost "/api/oauth/openai" '{"action":"start"}')
      code=$(jq -r '.userCode // empty' <<<"$response")
      url=$(jq -r '.verificationUrl // empty' <<<"$response")
      interval=$(jq -r '.intervalMs // 5000' <<<"$response")
      [ -n "$code" ] && [ -n "$url" ] || die "OpenAI OAuth did not return a device code"
      echo
      echo "Open this URL in any browser: $url"
      echo "Enter code: $code"
      echo "Waiting for authorization (Ctrl-C cancels this local wait; it does not expose the code)..."
      while true; do
        sleep "$(( interval / 1000 > 2 ? interval / 1000 : 3 ))"
        poll=$(jpost "/api/oauth/openai" '{"action":"poll"}')
        if [ "$(jq -r '.ok // false' <<<"$poll")" = true ]; then
          echo "  ✓ OpenAI connected as $(jq -r '.slug' <<<"$poll")"
          return
        fi
        [ "$(jq -r '.pending // false' <<<"$poll")" = true ] || die "OpenAI OAuth failed: $poll"
        tty_print "."
      done ;;
    2) provider=anthropic ;;
    3) provider=openai ;;
    4) provider=openrouter ;;
    5) provider=google ;;
    6) provider=groq ;;
    7) provider=xai ;;
    8) provider=deepseek ;;
    9) provider=mistral ;;
    *) echo "  ! unknown choice; skipped"; return ;;
  esac
  echo "  $provider uses an API key here (not OAuth). The key is never placed in argv."
  tty_secret "Paste $provider API key: "; key="$REPLY"
  [ -n "$key" ] || { echo "  -- empty key; skipped"; return; }
  body=$(printf '%s\0%s' "$provider" "$key" | provider_key_body)
  secret_post "/api/config" "$body" >/dev/null
  unset key body REPLY
  echo "  ✓ $provider configured for Alfa"
}

onboard_style() {
  local yes="$1" choice style
  if [ "$yes" = 1 ]; then
    echo "  -- response preset left unchanged (-y keeps existing/default settings)"
    return
  else
    echo
    echo "Alfa response preset (this is a response style, not a SKILL.md install)"
    echo "  0) Normal / off"
    echo "  1) Caveman — terse fragments, preserve technical substance"
    echo "  2) Ponytail — minimal senior-dev solution, avoid unnecessary code"
    tty_line "Choose [0]: " 0; choice="$REPLY"
    case "$choice" in 1) style=caveman ;; 2) style=ponytail ;; *) style=off ;; esac
  fi
  jpost "/api/config" "$(jq -nc --arg v "$style" '{tokenSaver:$v}')" >/dev/null
  echo "  ✓ Alfa response preset: $style"
}

wait_managed_job() {
  local app="$1" id="$2" since=0 data chunk status next
  echo "  installing $app (job $id)..."
  while true; do
    data=$(jget "/api/v1/managed-apps/$(enc "$app")/jobs/$(enc "$id")?since=$since")
    chunk=$(jq -r '.job.log // empty' <<<"$data")
    [ -z "$chunk" ] || printf '%s' "$chunk"
    next=$(jq -r '.job.logOffset // 0' <<<"$data"); since="$next"
    status=$(jq -r '.job.status // "unknown"' <<<"$data")
    case "$status" in
      succeeded) echo "  ✓ $app installed"; return ;;
      failed|interrupted) die "$app install ended: $status — $(jq -r '.job.error // "see job log"' <<<"$data")" ;;
    esac
    sleep 2
  done
}

onboard_apps() {
  local yes="$1" choice apps app response id
  if [ "$yes" = 1 ]; then
    echo "  -- optional managed apps skipped (-y uses minimal defaults)"
    return
  fi
  echo
  echo "Optional managed applications"
  echo "  These have their own runtime/provider settings; Alfa credentials above do not configure them."
  echo "  0) None"
  echo "  1) Hermes"
  echo "  2) OpenClaw"
  echo "  3) Both"
  tty_line "Choose [0]: " 0; choice="$REPLY"
  case "$choice" in 1) apps="hermes" ;; 2) apps="openclaw" ;; 3) apps="hermes openclaw" ;; *) return ;; esac
  for app in $apps; do
    if jget "/api/v1/managed-apps" | jq -e --arg id "$app" '.apps[] | select(.id==$id and .installed==true)' >/dev/null; then
      echo "  ✓ $app already installed"
      continue
    fi
    response=$(jpost "/api/v1/managed-apps/$(enc "$app")/install" '{}')
    id=$(jq -r '.job.id // empty' <<<"$response")
    [ -n "$id" ] || die "could not start $app install: $response"
    wait_managed_job "$app" "$id"
  done
}

onboard_skills() {
  local yes="$1" choice ids
  echo
  echo "Curated installable skills"
  node "$ROOT/scripts/skill-market.mjs" available
  if [ "$yes" = 1 ]; then
    echo "  -- none installed automatically; run: mso skills install ponytail caveman rtk -y"
    return
  fi
  echo "Enter skill ids separated by spaces/commas, 'all', or blank to skip."
  tty_line "Skills: " ""; choice="$REPLY"
  [ -n "$choice" ] || return
  if [ "$choice" = all ]; then ids=$(node "$ROOT/scripts/skill-market.mjs" available --json | jq -r '.skills[].id' | tr '\n' ' ')
  else ids=$(printf '%s' "$choice" | tr ',' ' '); fi
  # The user's selection is the confirmation; suppress per-skill install prompts.
  # shellcheck disable=SC2086
  node "$ROOT/scripts/skill-market.mjs" install $ids -y
}

run_onboard() {
  local yes=0
  case "${1-}" in -y|--yes) yes=1 ;; "") ;; *) die "usage: mso onboard [-y|--yes]" ;; esac
  echo "MSO onboarding"
  echo "=============="
  ensure_local_cli_device
  ensure_onboard_runtime
  if [ "$yes" = 0 ] && ! tty_ok; then
    die "interactive onboarding needs a terminal; use 'mso onboard -y' for safe minimal defaults"
  fi
  # Runtime liveness was verified without auth above; now prove the approved-device session.
  jget "/api/auth/me" >/dev/null
  onboard_ai "$yes"
  onboard_style "$yes"
  onboard_apps "$yes"
  onboard_infra "$yes"
  onboard_skills "$yes"
  echo
  echo "Onboarding complete."
  echo "  mso -h                 command reference"
  echo "  mso doctor             verify this install"
  echo "  mso skills available   installable skills"
  echo "  mso config show        Alfa provider/style"
  echo "  mso provider list      Dokploy/Cloudflare/Hostinger state"
  echo "  mso                    launch the interactive MSO Agent"
  echo "  mso mapp list          Hermes/OpenClaw state"
}
