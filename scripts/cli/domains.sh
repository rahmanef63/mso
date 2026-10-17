#!/usr/bin/env bash
# Owner-local domain settings remain available when the MSO web runtime is down.
run_domains() {
  [ -z "${BASE_OVERRIDE:-}${MSO_BASE:-}${OS_BASE:-}" ] \
    || die "domain commands configure THIS host; omit --base/MSO_BASE/OS_BASE and run on the intended MSO host"
  need bun
  local domain_env domain_local
  domain_env="$(realpath -m -- "$ENVF")"
  domain_local="$(gateway_local_url)"
  (cd "$ROOT"; MSO_DOMAIN_ENV="$domain_env" MSO_DOMAIN_LOCAL_ORIGIN="$domain_local" \
    bun --no-env-file --conditions=react-server "$ROOT/scripts/mso-domain.ts" "$@")
}
