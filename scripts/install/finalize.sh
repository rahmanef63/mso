#!/usr/bin/env bash
# Integrations, summary, reachability guidance, and onboarding Sourced by the verified installer core after checkout.
INSTALL_PHASE=integrations
# ---- optional Claude Code integration ----
# MSO catalogs $DIR/claude-skills directly, so these symlinks are NOT required by MSO.
# They only expose the same official playbooks to Claude Code when its home exists.
SKILL_DIR="${MSO_SKILL_DIR:-$HOME/.claude/skills}"
if [ -d "$DIR/claude-skills" ] && [ -d "$(dirname "$SKILL_DIR")" ]; then
  mkdir -p "$SKILL_DIR"
  for s in "$DIR"/claude-skills/*/; do
    name="$(basename "$s")"
    if [ -e "$SKILL_DIR/$name" ] && [ ! -L "$SKILL_DIR/$name" ]; then
      warn "skill $name exists and is not a symlink — left alone"
      continue
    fi
    ln -sfn "${s%/}" "$SKILL_DIR/$name"
  done
  # Prune ours that no longer exist. Only symlinks POINTING INTO this repo's
  # claude-skills are touched, so a hand-made or third-party skill is never
  # removed. Without this a deleted skill kept a dangling entry forever and the
  # agent still saw it listed (mso-browser-list did exactly that).
  for l in "$SKILL_DIR"/*; do
    [ -L "$l" ] || continue
    tgt="$(readlink "$l")"
    case "$tgt" in "$DIR/claude-skills/"*) [ -d "$tgt" ] || { rm -f "$l"; info "pruned stale skill $(basename "$l")"; } ;; esac
  done
  ok "skills → $SKILL_DIR (/mso, /mso-camoufox, /mso-apps, /mso-list, …)"
fi

INSTALL_PHASE=summary
# ---- next steps ----
# How to reach it depends on the bind AND on the Secure session cookie: a
# browser only keeps that cookie over plain http on localhost/127.0.0.1/::1, so
# any address that is not one of those needs TLS or a tunnel to log in at all.
WHOAMI="$(id -un)"
case "$BIND" in
  127.0.0.1|::1|localhost)
    REACH="tunnel from your own machine:
              ssh -N -L $PORT:127.0.0.1:$PORT $WHOAMI@<this-host>
            then open  http://localhost:$PORT
            (or \`tailscale serve $PORT\`, or a TLS reverse proxy → 127.0.0.1:$PORT)" ;;
  0.0.0.0|::)
    REACH="http://<this-host>:$PORT
            !! bound on EVERY interface. An authenticated session runs commands as
               $WHOAMI — firewall it, or re-run with --bind 127.0.0.1.
               Plain http to an IP also cannot log in: the session cookie is Secure." ;;
  *)
    REACH="http://$BIND:$PORT
            (plain http to a non-loopback address cannot complete a login — the
             session cookie is Secure. Put TLS in front, or tunnel to loopback.)" ;;
esac

if [ "$SERVICE_READY" -eq 1 ]; then
  OPEN_STATUS="$REACH"
  LOG_STATUS="journalctl -u mso -f"
elif [ "$DO_SERVICE" -eq 0 ]; then
  OPEN_STATUS="not running (--no-service). Start manually: cd $DIR && PORT=$PORT bun run start"
  LOG_STATUS="no system service installed"
elif [ "$SERVICE_ATTEMPTED" -eq 1 ]; then
  OPEN_STATUS="service was installed/restarted but did not pass health verification; inspect the journal before opening the UI"
  LOG_STATUS="journalctl -u mso -e"
elif is_wsl; then
  OPEN_STATUS="not running (WSL systemd is unavailable). Enable systemd or start manually from $DIR"
  LOG_STATUS="no system service installed"
else
  OPEN_STATUS="systemd is unavailable; start manually from $DIR"
  LOG_STATUS="no system service installed"
fi

if [ "$FRESH_INSTALL" -eq 1 ]; then
  ok "mso installed at $DIR"
else
  ok "mso updated at $DIR"
  info "existing .env.local and ~/.mso state preserved"
fi
cat <<EOF

  Runtime:   $OPEN_STATUS
  Env:       $DIR/.env.local
EOF
[ -n "$GEN_PW" ] && printf '  Password: %s   (shown once — save it now; edit OS_LOGIN_PASSWORD in .env.local + service refresh to change)\n' "$GEN_PW"
if [ "$FRESH_INSTALL" -eq 1 ]; then
cat <<EOF

  Pair your first device after the API is running (device approval is a browser allowlist, not standards-based 2FA):
    1. FIRST use HTTPS, or an SSH tunnel and http://localhost:$PORT. Do not pair on plain http://<server-ip>:$PORT:
       the Secure session cookie cannot persist there, and changing to an HTTPS hostname creates a different browser device id.
    2. Enter the password — the browser lands PENDING and shows a device id.
    3. On this server:
         node $DIR/scripts/approve-device.js --list                 # see the pending id
         node $DIR/scripts/approve-device.js <deviceId> "my phone"  # approve it
    4. In that SAME browser origin, click "Check again". Approve later devices from Settings → Devices.
EOF
fi
cat <<EOF

  Logs:      $LOG_STATUS
  Doctor:    mso doctor   (or: mso doctor --fix for safe local repairs)
  Onboard:   mso onboard
  Update:    mso update   (or Settings → About in the web UI)
  Legacy:    re-run the official one-line installer to upgrade/recover an older install
  Uninstall: re-run the installer with --uninstall
  Listen:    $BIND:$PORT   (change with --bind / MSO_BIND)
  Security: verify from OUTSIDE the box — \`curl -m5 http://<public-ip>:$PORT/api/health\`
            run on your laptop is the only test that proves what is reachable.
            Review ~/.mso/audit.log.
EOF

INSTALL_PHASE=onboarding
# A successful fresh install should lead directly into a usable product. curl|bash
# owns stdin, so interactive setup uses the controlling terminal explicitly.
RUN_ONBOARD=0
case "$ONBOARD_MODE" in
  always) RUN_ONBOARD=1 ;;
  never) RUN_ONBOARD=0 ;;
  auto) [ "$FRESH_INSTALL" -eq 1 ] && RUN_ONBOARD=1 ;;
esac
if [ "$RUN_ONBOARD" -eq 1 ] && [ "$SERVICE_READY" -eq 1 ]; then
  if [ "$YES" -eq 1 ]; then
    echo
    info "running minimal non-interactive onboarding (-y)…"
    "$BIN_DIR/mso" onboard -y || warn "onboarding did not finish — run: mso doctor --fix ; then: mso onboard"
  elif [ -r /dev/tty ] && [ -w /dev/tty ]; then
    echo
    info "starting guided onboarding…"
    if ! "$BIN_DIR/mso" onboard </dev/tty >/dev/tty 2>/dev/tty; then
      warn "onboarding stopped early — run: mso doctor --fix ; then resume: mso onboard"
    fi
  else
    echo
    warn "no interactive terminal detected — onboarding skipped. Run: mso onboard"
  fi
elif [ "$RUN_ONBOARD" -eq 1 ]; then
  warn "no verified running MSO API is available for onboarding — start/enable the service, then run 'mso onboard'"
fi
