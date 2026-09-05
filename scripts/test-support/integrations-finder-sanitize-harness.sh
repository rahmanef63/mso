#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
: "${MSO_CAPTURE_CONFIG:?capture path}" "${MSO_CAPTURE_PATH:?path marker}"
# shellcheck source=scripts/mso-cli-integrations-tui.sh
source "$ROOT/scripts/mso-cli-integrations-tui.sh"
node(){ printf '%s' "$2" > "$MSO_CAPTURE_PATH"; cp "$2" "$MSO_CAPTURE_CONFIG"; printf '%s' '{"type":"quit","selectedId":"","query":""}'; }
snap='{"users":[],"catalog":[],"connections":[{"id":"x","provider":"demo","stored":true,"value":"SYNTHETIC_SECRET_NEVER_TEMP","apiKey":"SYNTHETIC_SECRET_NEVER_TEMP"}]}'
integration_finder_event "$snap" '[]' '[]' '' '' >/dev/null
[ ! -e "$(cat "$MSO_CAPTURE_PATH")" ] || { echo 'temporary config was not removed' >&2; exit 1; }
