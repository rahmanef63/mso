#!/usr/bin/env bash
# Install/prove the CLI launcher and invoking-shell PATH Sourced by the verified installer core after checkout.
INSTALL_PHASE=cli
# ---- CLI on PATH (before deps/build/service so a partial WSL install still gets a CLI) ----
# The web UI is one frontend; bin/mso reaches the same /api surface from a shell.
BIN_DIR="${MSO_BIN_DIR:-$HOME/.local/bin}"
mkdir -p "$BIN_DIR"
ln -sfn "$DIR/bin/mso" "$BIN_DIR/mso"
ok "cli → $BIN_DIR/mso"

# A fresh distro/WSL home often omits ~/.local/bin from the current PATH. Persist
# one small idempotent block for future shells. Default to bash when SHELL is not
# exported (common in curl|bash/cloud-init); zsh gets its own rc instead.
path_block() {
  local rc="$1"
  [ -e "$rc" ] || : > "$rc"
  grep -q '^# >>> mso cli >>>$' "$rc" 2>/dev/null && return
  cat >> "$rc" <<'EOF'

# >>> mso cli >>>
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) export PATH="$HOME/.local/bin:$PATH" ;;
esac
# <<< mso cli <<<
EOF
  info "added ~/.local/bin to PATH in $rc"
}
if [ "$BIN_DIR" = "$HOME/.local/bin" ]; then
  path_block "$HOME/.profile"
  case "${SHELL:-/bin/bash}" in
    */zsh) path_block "$HOME/.zshrc" ;;
    *)     path_block "$HOME/.bashrc" ;;
  esac
else
  warn "custom MSO_BIN_DIR=$BIN_DIR is not written into shell profiles; add it to PATH yourself"
fi

# Prove discoverability from the PARENT shell's original PATH. If the user-local
# directory was already there, nothing else is needed. Otherwise use a guarded
# launcher in /usr/local/bin (or MSO_SYSTEM_BIN_DIR) only when that directory is
# already on the invoking PATH. This also makes `--no-service` useful on WSL.
PARENT_PATH_RESOLVED="$(normalize_parent_path "$PARENT_PATH" "$PARENT_CWD")"
SYSTEM_BIN_DIR="${MSO_SYSTEM_BIN_DIR:-/usr/local/bin}"
case "$SYSTEM_BIN_DIR" in /*) ;; *) SYSTEM_BIN_DIR="$PARENT_CWD/$SYSTEM_BIN_DIR" ;; esac
SYSTEM_CLI="$SYSTEM_BIN_DIR/mso"
TARGET_CLI_REAL="$(readlink -f "$DIR/bin/mso")"
CLI_IMMEDIATE=0
parent_cli="$(PATH="$PARENT_PATH_RESOLVED" command -v mso 2>/dev/null || true)"
if [ -n "$parent_cli" ] && [ "$(readlink -f "$parent_cli" 2>/dev/null || true)" = "$TARGET_CLI_REAL" ]; then
  CLI_IMMEDIATE=1
elif path_has_dir "$PARENT_PATH_RESOLVED" "$SYSTEM_BIN_DIR"; then
  if link_cli_guarded "$SYSTEM_CLI" "$DIR/bin/mso"; then
    ok "current-PATH cli → $SYSTEM_CLI"
    parent_cli="$(PATH="$PARENT_PATH_RESOLVED" command -v mso 2>/dev/null || true)"
    if [ -n "$parent_cli" ] && [ "$(readlink -f "$parent_cli" 2>/dev/null || true)" = "$TARGET_CLI_REAL" ]; then
      CLI_IMMEDIATE=1
    fi
  else
    warn "could not install $SYSTEM_CLI; the user CLI is still installed at $BIN_DIR/mso"
  fi
else
  info "$SYSTEM_BIN_DIR is not on the invoking PATH — skipped the extra launcher"
fi

# Validate the actual launcher independently of PATH. The child installer may use
# its own exported PATH for onboarding, but that is NOT treated as proof that the
# parent shell can see the command.
[ -x "$BIN_DIR/mso" ] || die "CLI launcher target is not executable: $BIN_DIR/mso"
"$BIN_DIR/mso" -h >/dev/null 2>&1 || die "CLI launcher self-check failed: $BIN_DIR/mso (verify curl/jq/coreutils and rerun)"
export PATH="$BIN_DIR:$PATH"
if [ "$CLI_IMMEDIATE" -eq 1 ]; then
  ok "mso -h will resolve immediately after the installer returns ($parent_cli)"
else
  warn "mso is installed, but this shell's existing PATH cannot see it yet"
  warn "for this shell run: export PATH=\"$BIN_DIR:\$PATH\""
  if [ "$BIN_DIR" = "$HOME/.local/bin" ]; then
    info "future shells will load the persisted ~/.local/bin PATH block"
  else
    warn "custom MSO_BIN_DIR is not persisted automatically; add $BIN_DIR to your shell profile"
  fi
fi
