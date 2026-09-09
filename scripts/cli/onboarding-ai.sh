#!/usr/bin/env bash
# Guided AI provider setup, using the shared private TTY/transport helpers.
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
        poll_seconds=$((interval / 1000))
        [ "$poll_seconds" -gt 2 ] || poll_seconds=3
        sleep "$poll_seconds"
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
