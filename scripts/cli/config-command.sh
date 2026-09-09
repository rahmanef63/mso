#!/usr/bin/env bash
# Settings mutation commands share the existing secret-safe transport.
mso_config_command() {
  local config_usage="$1"; shift
    case "${1:-show}" in
      show) jget "/api/config" ;;
      set)  jpost "/api/config" "$(json_arg "${2:?json, e.g. '{\"model\":\"gpt-5.6\"}'}")" ;;
      key)  provider="${2:?provider}"
            case "$provider" in
              anthropic|openai|openrouter|google|groq|xai|deepseek|mistral) ;;
              *) die "API-key provider must be one of: anthropic openai openrouter google groq xai deepseek mistral" ;;
            esac
            tty_secret "Paste $provider API key: "; key="$REPLY"
            [ -n "$key" ] || die "empty API key"
            body=$(printf '%s\0%s' "$provider" "$key" | provider_key_body)
            secret_post "/api/config" "$body"; unset key body REPLY ;;
      style) style="${2:?"off|caveman|ponytail"}"
             case "$style" in
               off|caveman|ponytail) ;;
               *) die "style must be off, caveman or ponytail" ;;
             esac
             jpost "/api/config" "$(jq -nc --arg v "$style" '{tokenSaver:$v}')" ;;
      rm)   jdel "/api/config?provider=$(enc "${2:?provider}")" ;;
      *) die "usage: mso $config_usage" ;;
    esac
}
