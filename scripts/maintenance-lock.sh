#!/usr/bin/env bash
# Only the local maintenance entrypoint calls this after validating its preview token.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/private-state.sh
source "$ROOT/scripts/lib/private-state.sh"
# shellcheck source=lib/runtime-exclusion.sh
source "$ROOT/scripts/lib/runtime-exclusion.sh"
runtime_exclusion_acquire exclusive 0 || { echo 'mso maintenance: runtime/update lock is busy; no maintenance applied' >&2; exit 1; }
trap runtime_exclusion_release EXIT
MSO_MAINTENANCE_LOCKED=1 node "$ROOT/scripts/mso-maintenance.mjs" "$@"
