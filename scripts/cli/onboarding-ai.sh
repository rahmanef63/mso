#!/usr/bin/env bash
# Guided AI setup. Provider/model discovery is shared with `mso models` and the Web UI.
onboard_ai() {
  local yes="$1" provider cfg data model rc
  if [ "$yes" = 1 ]; then
    echo "  -- AI provider skipped (-y keeps external accounts unconfigured)"
    return
  fi

  echo
  echo "AI for Alfa"
  echo "  Provider/model availability is loaded dynamically. FREE means the live catalog explicitly reports zero input + output token cost."
  echo "  A provider account/API key and provider rate limits may still apply."

  provider=$(
    {
      printf 'skip\tSkip for now\tConfigure later with mso models\t\n'
      dynamic_ai_provider_picker_rows "" ""
    } | tui_select "Connect AI platform" "skip"
  ) || {
    rc=$?
    [ "$rc" -eq 130 ] && { echo "  -- skipped"; return 0; }
    return "$rc"
  }
  [ "$provider" != skip ] || { echo "  -- skipped"; return; }

  configure_ai_provider "$provider"
  cfg=$(ai_model_config)
  data=$(ai_model_catalog "$provider" "$cfg")
  if ! jq -e '.models | length > 0' <<<"$data" >/dev/null 2>&1; then
    echo "  ✓ $provider connected; no model catalog is available right now. Choose one later with: mso model"
    return
  fi

  model=$(model_picker_rows "$data" "" | tui_select "Choose Alfa model · $provider" "") || {
    rc=$?
    [ "$rc" -eq 130 ] && { echo "  ✓ $provider connected; model selection skipped"; return 0; }
    return "$rc"
  }
  select_model_ref "$provider/$model"
}
