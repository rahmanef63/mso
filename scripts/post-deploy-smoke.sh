#!/usr/bin/env bash
# Post-deploy smoke test. Run AFTER the supported MSO deploy/release lifecycle.
# Catches the chunk-MIME drift that has bitten this deploy twice (per CLAUDE.md).
#
# REQUIRES: devDependencies installed on host (vitest lives in devDeps). Run
# `bun install` — NOT `bun install --production`. If the deploy artifact is
# prod-only (no dev deps), we fall back to a raw /api/health probe below so
# the deploy gate still catches a totally-broken server.
set -euo pipefail

BASE_URL="${OS_BASE_URL:-http://localhost:4005}"
echo "Smoke testing ${BASE_URL}..."
node scripts/check-served-assets.mjs "$BASE_URL"

# Prefer the full vitest smoke suite (4 checks: health, root HTML, chunk MIME,
# asset 200). Falls back to curl if vitest isn't on the deploy box.
# The probe is the local binary, deliberately NOT `bunx`/`bun x`: bunx DOWNLOADS a
# missing package and runs it, so the guard would always be true, the prod-only curl
# fallback below would become dead code, and a deploy of an authenticated remote shell
# would fetch-and-execute an npm package on the production host. `pnpm exec` never
# installed; this keeps that property.
if [ -x node_modules/.bin/vitest ]; then
  E2E_BASE_URL="${BASE_URL}" node_modules/.bin/vitest run scripts/e2e/smoke.test.ts --reporter=verbose
else
  echo "vitest not installed (prod-only deploy?) — falling back to curl /api/health"
  curl -sf --max-time 5 "${BASE_URL}/api/health" >/dev/null || {
    echo "health check failed at ${BASE_URL}/api/health" >&2
    exit 1
  }
fi

echo "Smoke OK."
