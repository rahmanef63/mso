#!/usr/bin/env bash
# Dynamic AI provider/model discovery helpers shared by onboarding and `mso models`.
# Sourced by scripts/mso-cli-agent.sh after HTTP/TTY transport helpers are available.
# Pricing is presentation metadata only: FREE means explicit zero input + output cost.

known_ai_provider_picker_rows() {
  cat <<'ROWS'
openai-codex	OpenAI ChatGPT	ChatGPT subscription · device OAuth
opencode	OpenCode Zen	API key · dynamic free models when available
anthropic	Anthropic	API key
openai	OpenAI Platform	API key
openrouter	OpenRouter	API key · multi-model router
google	Google Gemini	API key
groq	Groq	API key
xai	xAI	API key
deepseek	DeepSeek	API key
mistral	Mistral	API key
custom	Custom provider	OpenAI/Anthropic-compatible endpoint
ROWS
}

ai_provider_catalog() {
  jget "/api/models/providers"
}

dynamic_ai_provider_picker_rows() {
  local data="${1:-}" active="${2:-}"
  [ -n "$data" ] || data=$(ai_provider_catalog 2>/dev/null || true)
  if ! jq -e '.providers | length > 0' <<<"$data" >/dev/null 2>&1; then
    known_ai_provider_picker_rows
    return
  fi
  jq -r --arg active "$active" '.providers[] |
    [
      .id,
      (.name // .id),
      (if (.freeAgentModelCount // 0) > 0
        then "FREE · " + ((.freeAgentModelCount // 0)|tostring) + " agent-ready · " + ((.modelCount // 0)|tostring) + " models"
        else ((.modelCount // 0)|tostring) + " models · API key"
       end),
      (if .id == $active then "current" else "" end)
    ] | @tsv' <<<"$data"
  printf 'openai-codex	OpenAI ChatGPT	Subscription · device OAuth	%s\n' "$([ "$active" = openai-codex ] && printf current || true)"
  printf 'custom	Custom provider	OpenAI/Anthropic-compatible endpoint	\n'
}

ai_provider_supported() {
  local provider="$1" data
  data=$(ai_provider_catalog 2>/dev/null || true)
  if jq -e '.providers | length > 0' <<<"$data" >/dev/null 2>&1; then
    jq -e --arg p "$provider" 'any(.providers[]?; .id == $p)' <<<"$data" >/dev/null 2>&1
    return
  fi
  known_ai_provider_picker_rows | cut -f1 | grep -Fxq "$provider"
}

model_picker_rows() {
  local data="$1" current="${2-}"
  jq -r --arg current "$current" '.models
    | sort_by(if (.free == true and .agentReady == true) then 0 elif .free == true then 1 else 2 end, .id)
    | .[] |
    [
      .id,
      .id,
      ((if .free == true then "FREE · " else "" end)
        + (if (.context // 0) > 0 then "ctx " + ((.context // 0)|tostring) else "ctx —" end)
        + " · tools " + (if .tools then "yes" else "—" end)
        + " · reasoning " + (if .reasoning then "yes" else "—" end)),
      (if .id==$current then "current" else "" end)
    ] | @tsv' <<<"$data"
}

print_free_ai_options() {
  local provider="${1:-}" data
  if [ -n "$provider" ]; then
    data=$(jget "/api/models?provider=$(enc "$provider")&free=1")
    if ! jq -e '.models | length > 0' <<<"$data" >/dev/null 2>&1; then
      echo "No explicitly zero-cost models currently reported for $provider."
      return 1
    fi
    printf '%-36s %-7s %-10s %-8s %s\n' 'MODEL' 'AGENT' 'CONTEXT' 'REASON' 'NAME'
    jq -r '.models | sort_by(if .agentReady then 0 else 1 end, .id) | .[] |
      [.id,(if .agentReady then "yes" else "—" end),((.context // 0)|tostring),(if .reasoning then "yes" else "—" end),(.name // .id)] | @tsv' <<<"$data" |
      while IFS=$'\t' read -r id agent context reasoning name; do
        [ "$context" = 0 ] && context="—"
        printf '%-36s %-7s %-10s %-8s %s\n' "${id:0:36}" "$agent" "$context" "$reasoning" "${name:0:45}"
      done
    return
  fi
  data=$(jget "/api/models/providers?free=1")
  if ! jq -e '.providers | length > 0' <<<"$data" >/dev/null 2>&1; then
    echo "No provider currently reports explicitly zero-cost, agent-ready models."
    return 1
  fi
  echo "Free AI providers (live catalog; provider account/key and rate limits may still apply)"
  jq -r '.providers[] | [.id,(.name // .id),(.freeAgentModelCount|tostring),(.freeModelCount|tostring),(.recommendedFreeModel // "—")] | @tsv' <<<"$data" |
    while IFS=$'\t' read -r id name agent_count free_count recommended; do
      printf '  %-18s %-24s %3s agent-ready / %3s free   %s\n' "$id" "${name:0:24}" "$agent_count" "$free_count" "$recommended"
    done
}
