#!/usr/bin/env bash
# Hermetic fixture: run the real CLI handler with local transport replacements.
# No generated shell program, HTTP request, credential lookup or real service action.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/mso-cli-integrations.sh
source "$ROOT/scripts/mso-cli-integrations.sh"
enc() { printf '%s' "$1"; }
jget() { printf '%s' "$1"; }
jpost() { printf '%s' "$2"; }
die() { printf '%s' "$*" >&2; exit 2; }
tty_ok() { return 1; }
run_integrations "$@"
