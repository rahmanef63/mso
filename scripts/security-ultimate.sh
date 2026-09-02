#!/usr/bin/env bash
# Reproducible MSO security assurance gate. Scanner details stay private; stdout is a pass/fail summary.
set -euo pipefail
umask 077
# Transient/systemd jobs do not inherit an interactive shell PATH. Keep the gate
# reproducible when Bun was installed in its standard per-user location.
export PATH="$HOME/.bun/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)" || exit 1
cd "$ROOT"

TRIVY_IMAGE='aquasec/trivy@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969' # 0.74.0
OSV_VERSION='2.5.1'
OSV_LINUX_AMD64_SHA256='f9f25499a2c8cc367b3af45df2ea7eeca7fbccceab9c35079968f4b3652194be'
OSV_LINUX_ARM64_SHA256='3d0f5aa5a6baa8eb32bcef247388e149ef6030a6634ccae6fa0d62681fb27a6d'
GITLEAKS_IMAGE='zricethezav/gitleaks@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f' # 8.30.1
SEMGREP_IMAGE='semgrep/semgrep@sha256:f1f7b71861c7b28b6e0f661225a2c4f58a484f5d0f182465c6d6b3b22f972ade' # 1.174.0
SHELLCHECK_IMAGE='koalaman/shellcheck-alpine@sha256:9955be09ea7f0dbf7ae942ac1f2094355bb30d96fffba0ec09f5432207544002' # 0.11.0
ZAP_IMAGE="${MSO_SECURITY_ZAP_IMAGE:-ghcr.io/zaproxy/zaproxy@sha256:781a2bdaea47324e7bab583e2263f21d257b0aee61ed51521a5be45f5f5081ef}" # 2.17.0
DAST_URL="${MSO_SECURITY_DAST_URL:-https://mso.rahmanef.com}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
STATE_BASE="${MSO_SECURITY_STATE_BASE:-$HOME/.mso/security-assurance}"
RUN_DIR="${MSO_SECURITY_OUTPUT_DIR:-$STATE_BASE/$STAMP}"
SRC="$RUN_DIR/source"
LOGS="$RUN_DIR/logs"
mkdir -p "$SRC" "$LOGS"
chmod 700 "$RUN_DIR" "$SRC" "$LOGS"

cleanup() {
  rm -rf "$SRC"
}
trap cleanup EXIT INT TERM

need() { command -v "$1" >/dev/null 2>&1 || { echo "security: missing dependency: $1" >&2; exit 2; }; }
need git; need docker; need bun; need tar; need curl; need sha256sum

echo "MSO ultimate security gate"
echo "revision=$(git rev-parse --short=12 HEAD)"
echo "private_logs=$LOGS"

# Snapshot tracked files only: current tracked edits are included, untracked .env/state files are not.
git ls-files -z | tar --null -T - -cf - | tar -xf - -C "$SRC"

run_capture() {
  local name="$1"; shift
  local safe_name="${name//[^A-Za-z0-9._-]/-}"
  local log="$LOGS/$safe_name.log"
  mkdir -p "$LOGS"
  printf '%-28s ' "$name"
  if "$@" >"$log" 2>&1; then
    echo PASS
  else
    echo FAIL
    echo "security: $name failed; private diagnostics: $log" >&2
    return 1
  fi
}

OSV_TOOLS="$STATE_BASE/tools/osv-scanner/$OSV_VERSION"
OSV_BIN="$OSV_TOOLS/osv-scanner"
prepare_osv() {
  local arch asset expected url tmp
  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64) asset='osv-scanner_linux_amd64'; expected="$OSV_LINUX_AMD64_SHA256" ;;
    aarch64|arm64) asset='osv-scanner_linux_arm64'; expected="$OSV_LINUX_ARM64_SHA256" ;;
    *) echo "unsupported OSV architecture: $arch" >&2; return 2 ;;
  esac
  url="https://github.com/google/osv-scanner/releases/download/v${OSV_VERSION}/${asset}"
  mkdir -p "$OSV_TOOLS"
  chmod 700 "$STATE_BASE" "$STATE_BASE/tools" "$STATE_BASE/tools/osv-scanner" "$OSV_TOOLS" 2>/dev/null || true
  if [[ -L "$OSV_BIN" ]]; then echo "refusing symlinked OSV binary" >&2; return 2; fi
  if [[ -f "$OSV_BIN" ]] && printf '%s  %s\n' "$expected" "$OSV_BIN" | sha256sum -c - >/dev/null 2>&1; then
    chmod 700 "$OSV_BIN"
    return 0
  fi
  tmp="$OSV_TOOLS/.osv-scanner.$$.tmp"
  rm -f "$tmp"
  if ! curl --fail --location --silent --show-error --retry 2 --connect-timeout 10 --output "$tmp" "$url"; then
    rm -f "$tmp"; return 1
  fi
  if ! printf '%s  %s\n' "$expected" "$tmp" | sha256sum -c -; then
    rm -f "$tmp"; return 1
  fi
  chmod 700 "$tmp"
  mv -f "$tmp" "$OSV_BIN"
  printf '%s  %s\n' "$expected" "$OSV_BIN" | sha256sum -c -
}

run_capture "repository verify" bun run verify
run_capture "installer syntax" bash -c 'bash -n scripts/install.sh && bash -n scripts/install-core.sh'
run_capture "Trivy high/critical" docker run --rm -v "$SRC:/src:ro" "$TRIVY_IMAGE" \
  fs --scanners vuln,misconfig,secret --severity HIGH,CRITICAL --exit-code 1 /src
run_capture "OSV binary integrity" prepare_osv
OSV_HOME="$RUN_DIR/osv-home"
mkdir -p "$OSV_HOME"; chmod 700 "$OSV_HOME"
run_capture "OSV dependencies" env HOME="$OSV_HOME" "$OSV_BIN" scan source --recursive "$SRC"
run_capture "Gitleaks history" docker run --rm -v "$ROOT:/repo:ro" "$GITLEAKS_IMAGE" \
  git --no-banner --redact --gitleaks-ignore-path /repo/.gitleaksignore /repo
run_capture "Semgrep OWASP/SAST" docker run --rm -v "$SRC:/src:ro" "$SEMGREP_IMAGE" \
  semgrep scan --metrics=off --config=p/javascript --config=p/typescript --config=p/owasp-top-ten --error /src

mapfile -t shell_files < <(git grep -Il '^#!.*sh' -- '*.sh' 'bin/*' 'scripts/*' 'claude-skills/*' || true)
shell_args=()
for file in "${shell_files[@]}"; do shell_args+=("/src/$file"); done
if ((${#shell_args[@]} > 0)); then
  run_capture "ShellCheck warnings" docker run --rm -v "$SRC:/src:ro" "$SHELLCHECK_IMAGE" \
    shellcheck --severity=warning -e SC1090,SC2034 "${shell_args[@]}"
fi

if [[ "${MSO_SECURITY_SKIP_CODEX:-0}" != "1" ]]; then
  run_capture "Codex Security components" env CODEX_SECURITY_FAIL_ON_SEVERITY=high \
    CODEX_SECURITY_COMPONENT_WORKERS="${CODEX_SECURITY_COMPONENT_WORKERS:-2}" \
    CODEX_SECURITY_COMPONENT_MAX_COST_USD="${CODEX_SECURITY_COMPONENT_MAX_COST_USD:-8}" \
    CODEX_SECURITY_OUTPUT_ROOT="$RUN_DIR/codex-results" \
    CODEX_SECURITY_STATE_DIR="$RUN_DIR/codex-state" \
    ./scripts/codex-security-components.sh
else
  printf '%-28s %s\n' "Codex Security components" SKIPPED
fi

if [[ "${MSO_SECURITY_SKIP_DAST:-0}" != "1" ]]; then
  if [[ -z "$ZAP_IMAGE" ]]; then
    echo "security: MSO_SECURITY_ZAP_IMAGE is required unless MSO_SECURITY_SKIP_DAST=1" >&2
    exit 2
  fi
  ZAP_WORK="$RUN_DIR/zap-work"
  mkdir -p "$ZAP_WORK"
  cp "$ROOT/security/zap-baseline.conf" "$ZAP_WORK/zap-baseline.conf"
  # ZAP 2.17's Automation Framework writes zap.yaml/report state under /zap/wrk.
  # The parent RUN_DIR is 0700; this child is writable only so the unprivileged
  # container user can create its ephemeral files. It contains no credentials.
  chmod 777 "$ZAP_WORK"
  chmod 644 "$ZAP_WORK/zap-baseline.conf"
  run_capture "OWASP ZAP baseline" docker run --rm -t \
    -v "$ZAP_WORK:/zap/wrk:rw" "$ZAP_IMAGE" \
    zap-baseline.py -t "$DAST_URL" -m 2 -c zap-baseline.conf
  chmod 700 "$ZAP_WORK"
else
  printf '%-28s %s\n' "OWASP ZAP baseline" SKIPPED
fi

echo "security: ULTIMATE PASS"
