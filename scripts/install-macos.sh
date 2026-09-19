#!/usr/bin/env bash
# macOS compatibility bootstrap for MSO.
#
# MSO's host layer intentionally keeps one Linux runtime contract. On macOS,
# Lima supplies that Linux runtime and this script installs a host-side mso
# launcher that delegates commands into the guest.
set -Eeuo pipefail
umask 077

INSTANCE="${MSO_LIMA_INSTANCE:-mso}"
INSTALL_URL="${MSO_INSTALL_URL:-https://raw.githubusercontent.com/rahmanef63/mso/main/scripts/install.sh}"
BIN_DIR="${MSO_BIN_DIR:-$HOME/.local/bin}"

info() { printf '· %s\n' "$*"; }
ok() { printf '✓ %s\n' "$*"; }
fail() { printf '✗ %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "run this bootstrap on macOS."

if ! command -v limactl >/dev/null 2>&1; then
  command -v brew >/dev/null 2>&1 || fail "Lima is required. Install Homebrew, then rerun; or install Lima yourself."
  info "installing Lima with Homebrew"
  brew install lima
fi

if limactl list --format '{{.Name}}' 2>/dev/null | grep -Fxq "$INSTANCE"; then
  info "starting/reusing Lima instance: $INSTANCE"
  limactl start "$INSTANCE"
else
  info "creating Lima Linux instance: $INSTANCE"
  limactl start --name="$INSTANCE" --tty=false template:default
fi

info "installing/updating MSO inside Lima"
limactl shell "$INSTANCE" bash -lc "
  set -Eeuo pipefail
  unset PREFIX TERMUX_VERSION
  export PATH=\"\$HOME/.local/bin:\$HOME/.bun/bin:\$PATH\"
  curl -fsSL '$INSTALL_URL' | bash -s -- --no-service --no-onboard
  command -v mso >/dev/null
  mso --version
  mso -h >/dev/null
"

mkdir -p "$BIN_DIR"
LAUNCHER="$BIN_DIR/mso"
cat > "$LAUNCHER" <<EOF_LAUNCHER
#!/usr/bin/env bash
set -Eeuo pipefail
limactl start "$INSTANCE" >/dev/null
exec limactl shell "$INSTANCE" bash -lc 'export PATH="\$HOME/.local/bin:\$HOME/.bun/bin:\$PATH"; exec mso "\$@"' mso "\$@"
EOF_LAUNCHER
chmod 0755 "$LAUNCHER"

persist_path() {
  local rc="$1"
  touch "$rc"
  grep -Fq '# >>> mso cli >>>' "$rc" 2>/dev/null && return
  cat >> "$rc" <<'EOF_PATH'

# >>> mso cli >>>
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) export PATH="$HOME/.local/bin:$PATH" ;;
esac
# <<< mso cli <<<
EOF_PATH
}
persist_path "$HOME/.zprofile"
persist_path "$HOME/.bash_profile"

ok "MSO is installed for macOS through Lima."
printf '\nFor this shell if needed:\n  export PATH="$HOME/.local/bin:$PATH"\n'
printf 'Verify:\n  mso --version\n  mso doctor\n'
printf 'Start workspace:\n  mso web\n'
printf '\nMSO manages the Linux guest, not macOS launchd/processes directly. The raw app bind remains loopback-only by default.\n'
