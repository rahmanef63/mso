#!/usr/bin/env bash
# Stable CLI runtime composition. Each module owns one responsibility.
# shellcheck source=service.sh
source "$ROOT/scripts/cli/service.sh"
# shellcheck source=transport.sh
source "$ROOT/scripts/cli/transport.sh"
# shellcheck source=onboarding.sh
source "$ROOT/scripts/cli/onboarding.sh"
