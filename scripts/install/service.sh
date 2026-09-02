#!/usr/bin/env bash
# Install/restart/verify the systemd service and restore fallbacks Sourced by the verified installer core after checkout.
INSTALL_PHASE=service
# ---- systemd unit ----
if [ "$DO_SERVICE" -eq 1 ] && systemd_ready; then
  SERVICE_ATTEMPTED=1
  # Start via npm (always on PATH, ships with node) to match the proven prod unit;
  # PORT/HOSTNAME are set as env too so `next start` binds correctly regardless.
  NPM_BIN="$(command -v npm)"
  RUNTIME_INSTANCE_ID="$(rand_hex 16)"
  info "installing $SERVICE (needs sudo)…"
  sudo_do tee "/etc/systemd/system/$SERVICE" >/dev/null <<EOF
[Unit]
Description=Manef Shell OS — browser-based visual shell for a Linux server
After=network.target

[Service]
Type=simple
User=$(id -un)
WorkingDirectory=$DIR
EnvironmentFile=$DIR/.env.local
Environment=PORT=$PORT
Environment=HOSTNAME=$BIND
# Fresh on every installer-driven restart. /api/health echoes this non-secret nonce
# so readiness proves the HTTP response came from THIS restarted unit, not a stale
# process that happened to keep answering on the configured port.
Environment=MSO_RUNTIME_INSTANCE_ID=$RUNTIME_INSTANCE_ID
# A system unit with User= inherits no login session, so it gets no user-bus
# address and every \`systemctl --user\` it runs answers "Failed to connect to bus:
# No medium found". That silently broke the managed-app installs (which create
# systemd USER units) and made installed apps read as "not installed". Paired with
# the \`loginctl enable-linger\` below, without which /run/user/<uid> is destroyed
# at logout.
#
# The UID IS WRITTEN OUT, NOT the %U specifier. Do not "tidy" this back to %U — it
# was tried and it FAILS: with User=example and UID=1000, systemd 255 expanded %U
# to 0, so the unit got XDG_RUNTIME_DIR=/run/user/0 and every systemctl --user
# answered "No such file or directory" — the original bug wearing a new message.
# Specifiers are expanded while the unit is parsed, before the NAME in User= has
# been resolved to a uid, so %U falls back to the manager's own uid (root).
Environment=XDG_RUNTIME_DIR=/run/user/$(id -u)
# systemd would otherwise give this unit only
# /usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin. Both managed-app CLIs install
# themselves into ~/.local/bin, so without this \`which hermes\` fails inside the
# service on a host where it plainly works in a terminal.
Environment=PATH=$HOME/.local/bin:$HOME/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=$NPM_BIN run start -- --hostname $BIND --port $PORT
Restart=always
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=20
MemoryMax=3G
StandardOutput=journal
StandardError=journal
SyslogIdentifier=mso

[Install]
WantedBy=multi-user.target
EOF
  # A wildcard bind is not an address you can dial; probe loopback instead.
  HEALTH_HOST="$BIND"
  case "$BIND" in 0.0.0.0|::|"") HEALTH_HOST=127.0.0.1 ;; esac

  # Makes /run/user/<uid> — where the user bus lives — exist without a login
  # session and survive logout. The XDG_RUNTIME_DIR above names that directory, so
  # without linger it would point at nothing after the installing shell exits.
  # Idempotent; failure is not fatal, it only means managed-app installs will say
  # so plainly when they preflight the bus.
  sudo_do loginctl enable-linger "$(id -un)" >/dev/null 2>&1 \
    || warn "could not enable linger for $(id -un) — self-update and managed-app user services may stop after logout"
  # `enable-linger` makes the manager persistent, but some minimal images do not
  # start user@UID.service until the next login. Start it now so the first update
  # button works immediately, then prove the bus MSO will use actually answers.
  sudo_do systemctl start "user@$(id -u).service" >/dev/null 2>&1 \
    || warn "could not start the per-user systemd manager — self-update may be unavailable"
  if ! XDG_RUNTIME_DIR="/run/user/$(id -u)" systemctl --user show-environment >/dev/null 2>&1; then
    warn "per-user systemd bus is unavailable — self-update and managed-app services will not work until user@$(id -u).service is running"
  fi

  sudo_do systemctl daemon-reload
  sudo_do systemctl enable "$SERVICE"
  # restart, NOT `enable --now`. `--now` only *starts*, and a start on a unit
  # that is already running is a no-op — so re-running this installer used to
  # fetch, rebuild and then leave the OLD process serving a .next that had been
  # replaced underneath it. Every chunk 404s and nosniff makes that fatal
  # (docs/TROUBLESHOOTING.md). `restart` starts an inactive unit just as well,
  # so this is also correct on a first install.
  sudo_do systemctl restart "$SERVICE"
  ok "$SERVICE enabled + restarted"

  info "waiting for http://$HEALTH_HOST:$PORT/api/health …"
  up=0
  for _ in $(seq 1 30); do
    body="$(curl -fsS --max-time 3 "http://$HEALTH_HOST:$PORT/api/health" 2>/dev/null || true)"
    if [ -n "$body" ]; then
      now_build="$(printf '%s' "$body" | sed -n 's/.*"buildId":"\([^"]*\)".*/\1/p')"
      now_instance="$(printf '%s' "$body" | sed -n 's/.*"runtimeInstanceId":"\([^"]*\)".*/\1/p')"
      # A healthy response is accepted only when it carries the nonce injected into
      # THIS service unit before restart. This remains correct when NEXT_DEPLOYMENT_ID
      # intentionally keeps buildId stable and cannot be satisfied by a stale or
      # unrelated process still listening on the same port.
      if [ "$now_instance" = "$RUNTIME_INSTANCE_ID" ]; then
        up=1; SERVICE_READY=1
        ok "health OK (build ${now_build:-unknown}, runtime instance verified)"
        break
      fi
    fi
    sleep 2
  done
  if [ "$up" -ne 1 ]; then
    # is-active needs no privileges — do not spend a sudo prompt on the sad path.
    if systemctl is-active --quiet "$SERVICE"; then
      warn "service is running but /api/health did not prove the restarted runtime instance — check: journalctl -u mso -e"
    else
      warn "$SERVICE is not running — check: journalctl -u mso -e"
    fi
  fi
elif [ "$DO_SERVICE" -eq 1 ]; then
  if is_wsl; then
    warn "WSL detected without systemd as PID 1 — service install skipped; the mso CLI is still installed"
    info "for the full service: enable systemd in /etc/wsl.conf, run 'wsl --shutdown' from Windows, reopen WSL, then re-run this installer --onboard"
  else
    warn "systemd is not available as PID 1 — service install skipped; run manually: PORT=$PORT bun run start"
  fi
fi

INSTALL_PHASE=runtime-restore
# `.next` and service state are stable. Release the exclusive mutation lock before
# local-start takes its shared side, then restore every previously-owned fallback
# using the exact env-file identity persisted with that runtime.
install_runtime_lifecycle_finish
trap - EXIT HUP INT TERM
