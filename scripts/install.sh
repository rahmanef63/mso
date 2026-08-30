#!/usr/bin/env bash
# mso (Manef Shell OS) one-command installer — fresh single-owner Linux VPS.
#
#   curl -fsSL https://raw.githubusercontent.com/rahmanef63/mso/main/scripts/install.sh | bash
#
# Idempotent: re-running updates the checkout, rebuilds, and restarts the
# service. The bootstrap never needs stdin, so curl|bash stays safe. After a
# FRESH install it uses /dev/tty (when present) for guided onboarding; CI/headless
# installs never hang and can run `mso onboard` later. Existing .env.local is preserved.
set -euo pipefail

# ---- config: env override > flag > default ----
REPO_URL="${MSO_REPO:-https://github.com/rahmanef63/mso.git}"
DIR="${MSO_DIR:-$HOME/mso}"
DIR_EXPLICIT=0
REF="${MSO_REF:-main}"
PORT="${MSO_PORT:-4005}"
# Address the server listens on. Loopback by DEFAULT, for two reasons that point
# the same way:
#   1. It cannot log in otherwise. sessionCookieAttrs() sets `secure: true`
#      (lib/auth/session-cookie.ts), and a browser only accepts a Secure cookie
#      over plain http on a trustworthy origin — localhost / 127.0.0.1 / ::1. So
#      http://<lan-or-public-ip>:PORT returns 200 on login and then silently
#      drops the cookie: an endless login loop. A 0.0.0.0 bind buys no working
#      access it did not already have.
#   2. It is a shell. An authenticated session runs commands as this user, and a
#      fresh VPS has ufw installed but disabled — so the old default published
#      that shell to the whole internet about two minutes into a curl|bash.
# Reach it over an SSH tunnel, `tailscale serve`, or a reverse proxy on this host
# (all three land the browser on a trustworthy origin, so the cookie sticks).
BIND="${MSO_BIND:-127.0.0.1}"
SERVICE="mso.service"
DO_SERVICE=1
DO_UNINSTALL=0
YES=0
ONBOARD_MODE=auto
FRESH_INSTALL=0
# bun is the package manager; the RUNTIME stays node (see ensure_bun below).
export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
# Reproducible bootstrap: this is Bun v1.3.14's installer source, pinned by
# immutable Git commit and verified before execution. Update both values together.
BUN_BOOTSTRAP_COMMIT="0d9b296af33f2b851fcbf4df3e9ec89751734ba4"
BUN_BOOTSTRAP_SHA256="bab8acfb046aac8c72407bdcce903957665d655d7acaa3e11c7c4616beae68dd"

# ---- pretty output (tty + NO_COLOR aware) ----
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_DIM=$'\033[2m'; C_RST=$'\033[0m'
else
  C_OK=; C_WARN=; C_ERR=; C_DIM=; C_RST=
fi
info() { printf '%s·%s %s\n' "$C_DIM"  "$C_RST" "$*"; }
ok()   { printf '%s✓%s %s\n' "$C_OK"   "$C_RST" "$*"; }
warn() { printf '%s!%s %s\n' "$C_WARN" "$C_RST" "$*" >&2; }
die()  { printf '%s✗%s %s\n' "$C_ERR"  "$C_RST" "$*" >&2; exit 1; }

usage() {
  cat <<EOF
mso installer
  --dir PATH     install dir (default: \$HOME/mso, or an existing service's dir)
  --ref REF      git ref/branch/tag to check out (default: main)
  --port N       listen port (default: 4005)
  --bind ADDR    listen address (default: 127.0.0.1). 0.0.0.0 publishes a shell
                 to every network this host is on — see the note in this file.
  --no-service   build only; skip the systemd unit
  --onboard      run guided onboarding even on an existing install
  --no-onboard   never start onboarding automatically
  -y, --yes      safe non-interactive defaults (no external accounts/apps/skills)
  --uninstall    stop+disable+remove the systemd unit (keeps code + ~/.mso)
  -h, --help     this help
Env: MSO_DIR  MSO_REF  MSO_PORT  MSO_BIND  MSO_REPO
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dir)        DIR="$2"; DIR_EXPLICIT=1; shift 2 ;;
    --ref)        REF="$2"; shift 2 ;;
    --port)       PORT="$2"; shift 2 ;;
    --bind)       BIND="$2"; shift 2 ;;
    --no-service) DO_SERVICE=0; shift ;;
    --onboard)    ONBOARD_MODE=always; shift ;;
    --no-onboard) ONBOARD_MODE=never; shift ;;
    -y|--yes)     YES=1; shift ;;
    --uninstall)  DO_UNINSTALL=1; shift ;;
    -h|--help)    usage; exit 0 ;;
    *)            die "unknown arg: $1 (see --help)" ;;
  esac
done

# ---- never as root: an authed session gets shell as this user ----
[ "$(id -u)" -ne 0 ] || die "run as your normal NON-root user, not root (mso runs shell as the process user)."

sudo_do() { if command -v sudo >/dev/null 2>&1; then sudo "$@"; else die "need root for: $* (install sudo or run the step by hand)"; fi; }

# If a service already exists, update IT in place (unless --dir was given) — so a
# re-run never spins up a divergent second copy next to a working install.
if [ "$DIR_EXPLICIT" -eq 0 ] && command -v systemctl >/dev/null 2>&1; then
  existing="$(systemctl show -p WorkingDirectory --value "$SERVICE" 2>/dev/null || true)"
  [ -n "$existing" ] && [ -d "$existing/.git" ] && DIR="$existing" && info "found existing service → updating $DIR"
fi
[ -d "$DIR/.git" ] || FRESH_INSTALL=1

# ---- uninstall ----
if [ "$DO_UNINSTALL" -eq 1 ]; then
  # Guarded: without this, --uninstall on a box that never had the unit still
  # asks for a sudo password and then claims to have removed something.
  if command -v systemctl >/dev/null 2>&1 && [ -f "/etc/systemd/system/$SERVICE" ]; then
    sudo_do systemctl disable --now "$SERVICE" 2>/dev/null || true
    sudo_do rm -f "/etc/systemd/system/$SERVICE"
    sudo_do systemctl daemon-reload
    ok "removed $SERVICE"
  else
    info "no $SERVICE installed — nothing to remove"
  fi

  # Take back the symlinks this script created. Both are resolved and compared
  # against $DIR first, so a hand-made `mso` on PATH or a third-party skill of
  # the same name is never touched.
  UNINST_BIN="${MSO_BIN_DIR:-$HOME/.local/bin}/mso"
  if [ -L "$UNINST_BIN" ] && case "$(readlink "$UNINST_BIN")" in "$DIR/"*) true ;; *) false ;; esac; then
    rm -f "$UNINST_BIN"; ok "removed cli symlink $UNINST_BIN"
  fi
  if [ -L /usr/local/bin/mso ] && case "$(readlink /usr/local/bin/mso)" in "$DIR/"*) true ;; *) false ;; esac; then
    sudo_do rm -f /usr/local/bin/mso; ok "removed cli symlink /usr/local/bin/mso"
  fi
  UNINST_SKILLS="${MSO_SKILL_DIR:-$HOME/.claude/skills}"
  if [ -d "$UNINST_SKILLS" ]; then
    for l in "$UNINST_SKILLS"/*; do
      [ -L "$l" ] || continue
      case "$(readlink "$l")" in "$DIR/claude-skills/"*) rm -f "$l"; info "removed skill $(basename "$l")" ;; esac
    done
  fi

  info "code left at $DIR and data at ~/.mso — delete by hand if you want them gone."
  exit 0
fi

# ---- prereqs ----
ensure_git() {
  command -v git >/dev/null 2>&1 && return
  info "installing git…"
  if   command -v apt-get >/dev/null 2>&1; then sudo_do apt-get update -qq && sudo_do apt-get install -y -qq git
  elif command -v dnf     >/dev/null 2>&1; then sudo_do dnf install -y -q git
  elif command -v pacman  >/dev/null 2>&1; then sudo_do pacman -Sy --noconfirm git
  else die "git missing and no known package manager — install git and re-run."; fi
}

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  node -e 'const[a,b]=process.versions.node.split(".").map(Number);process.exit(a>20||(a===20&&b>=9)?0:1)'
}
ensure_node() {
  node_ok && { info "node $(node -v) ok"; return; }
  warn "Node >=20.9 not found"
  if command -v apt-get >/dev/null 2>&1; then
    info "installing Node 22 via NodeSource…"
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo_do -E bash -
    sudo_do apt-get install -y -qq nodejs
  else
    die "install Node >=20.9 (22 recommended) from https://nodejs.org or your distro, then re-run."
  fi
  node_ok || die "Node still <20.9 after install."
}

# bun installs dependencies; it does NOT run the app. `next start` stays on node
# (see the unit's ExecStart below) because node-pty's binding is built against
# node's ABI and the whole /api/v1 surface imports it.
ensure_bun() {
  command -v bun >/dev/null 2>&1 && { info "bun $(bun -v) ok"; return; }
  command -v sha256sum >/dev/null 2>&1 || die "sha256sum is required to verify the Bun bootstrap."
  info "installing Bun from a pinned, verified bootstrap…"
  local bootstrap actual url
  bootstrap="$(mktemp)"
  url="https://raw.githubusercontent.com/oven-sh/bun/$BUN_BOOTSTRAP_COMMIT/src/cli/install.sh"
  curl -fsSL "$url" -o "$bootstrap" || { rm -f "$bootstrap"; die "Bun bootstrap download failed."; }
  actual="$(sha256sum "$bootstrap" | awk '{print $1}')"
  [ "$actual" = "$BUN_BOOTSTRAP_SHA256" ] || {
    rm -f "$bootstrap"
    die "Bun bootstrap integrity check failed."
  }
  bash "$bootstrap" >/dev/null 2>&1 || { rm -f "$bootstrap"; die "bun install failed."; }
  rm -f "$bootstrap"
  export PATH="$BUN_INSTALL/bin:$PATH"
  command -v bun >/dev/null 2>&1 || die "bun installed but not on PATH — add $BUN_INSTALL/bin."
}

ensure_buildtools() {
  # node-pty is a native addon with no linux prebuild → needs a C/C++ toolchain +
  # python3 to compile at install time, under bun exactly as under pnpm.
  # This is the single most likely install failure on a minimal box.
  command -v cc >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1 && return
  info "installing build toolchain (for node-pty)…"
  if   command -v apt-get >/dev/null 2>&1; then sudo_do apt-get update -qq && sudo_do apt-get install -y -qq build-essential python3
  elif command -v dnf     >/dev/null 2>&1; then sudo_do dnf install -y -q gcc-c++ make python3
  elif command -v pacman  >/dev/null 2>&1; then sudo_do pacman -Sy --noconfirm base-devel python
  else warn "no known package manager — if 'bun install' fails on node-pty, install a C++ toolchain + python3 by hand."; fi
}

ensure_git; ensure_node; ensure_bun; ensure_buildtools

# portable 32-byte hex RNG (node is guaranteed present by now)
rand_hex() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex "$1"
  else node -e "process.stdout.write(require('crypto').randomBytes($1).toString('hex'))"; fi
}

rand_password() {
  node -e 'const c="ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";const b=require("crypto").randomBytes(24);let s="";for(const x of b)s+=c[x%c.length];process.stdout.write(s)'
}

# ---- clone or update (idempotent, resilient to a dirty tree) ----
if [ -d "$DIR/.git" ]; then
  info "updating existing checkout at $DIR"
  old_commit="$(git -C "$DIR" rev-parse --short HEAD)"
  if [ -n "$(git -C "$DIR" status --porcelain)" ]; then
    die "checkout has uncommitted changes at $DIR. Commit/stash them, or install into another --dir. Current commit: $old_commit"
  fi
  info "current commit: $old_commit"
  git -C "$DIR" fetch --quiet origin "$REF" || die "could not fetch origin $REF"
  target_commit="$(git -C "$DIR" rev-parse --short FETCH_HEAD)" || die "could not resolve fetched ref $REF"
  info "target commit:  $target_commit"
  git -C "$DIR" checkout --quiet FETCH_HEAD || die "could not check out $target_commit"
  ok "updated checkout $old_commit → $(git -C "$DIR" rev-parse --short HEAD)"
else
  info "cloning $REPO_URL → $DIR"
  git clone --quiet --branch "$REF" "$REPO_URL" "$DIR" 2>/dev/null || git clone --quiet "$REPO_URL" "$DIR"
fi
cd "$DIR"

# ---- deps (compiles node-pty) ----
info "installing dependencies…"
bun install --frozen-lockfile || bun install

# ---- data dir + secrets (write .env.local only if absent) ----
mkdir -p "$HOME/.mso" && chmod 700 "$HOME/.mso"

GEN_PW=""
if [ ! -f .env.local ]; then
  SECRET="$(rand_hex 32)"
  GEN_PW="$(rand_password)"
  ( umask 077
    cat > .env.local <<EOF
# mso — generated by install.sh. Private; NEVER commit.
OS_LOGIN_PASSWORD=$GEN_PW
OS_SESSION_SECRET=$SECRET
# SESSION_EXPIRY_HOURS=24
# OS_FS_READ_ROOTS=~:~/projects
# OS_FS_WRITE_ROOTS=~:~/projects
# OS_AUDIT_LOG=~/.mso/audit.log
EOF
  )
  chmod 600 .env.local
  ok "wrote .env.local (login password + session secret generated)"
else
  info ".env.local exists — left untouched (existing secrets preserved)"
fi

# ---- build ----
info "building (next build)…"
bun run build

# ---- systemd unit ----
if [ "$DO_SERVICE" -eq 1 ] && command -v systemctl >/dev/null 2>&1; then
  # Start via npm (always on PATH, ships with node) to match the proven prod unit;
  # PORT/HOSTNAME are set as env too so `next start` binds correctly regardless.
  NPM_BIN="$(command -v npm)"
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
# A system unit with User= inherits no login session, so it gets no user-bus
# address and every \`systemctl --user\` it runs answers "Failed to connect to bus:
# No medium found". That silently broke the managed-app installs (which create
# systemd USER units) and made installed apps read as "not installed". Paired with
# the \`loginctl enable-linger\` below, without which /run/user/<uid> is destroyed
# at logout.
#
# The UID IS WRITTEN OUT, NOT the %U specifier. Do not "tidy" this back to %U — it
# was tried and it FAILS: with User=antinrml and UID=1000, systemd 255 expanded %U
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

  # Read the id of the build that is CURRENTLY answering, before we touch the
  # unit. Every build gets a fresh NEXT_PUBLIC_BUILD_ID (next.config.mjs), so a
  # changed id is what proves the new process took over.
  prev_build="$(curl -fsS --max-time 3 "http://$HEALTH_HOST:$PORT/api/health" 2>/dev/null \
                | sed -n 's/.*"buildId":"\([^"]*\)".*/\1/p' || true)"

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
      # Gate on the id, not on curl's exit status: the old process answers
      # /api/health perfectly while serving stale chunks, which is exactly how
      # a failed update used to report "health OK".
      if [ -z "$prev_build" ] || [ "$now_build" != "$prev_build" ]; then
        up=1; ok "health OK (build ${now_build:-unknown})"; break
      fi
    fi
    sleep 2
  done
  if [ "$up" -ne 1 ]; then
    # is-active needs no privileges — do not spend a sudo prompt on the sad path.
    if systemctl is-active --quiet "$SERVICE"; then
      warn "service is running but still serving build $prev_build — check: journalctl -u mso -e"
    else
      warn "$SERVICE is not running — check: journalctl -u mso -e"
    fi
  fi
else
  [ "$DO_SERVICE" -eq 1 ] && warn "no systemctl here — skipping service. Run manually: PORT=$PORT bun run start"
fi

# ---- CLI on PATH ----
# The web UI is one frontend; bin/mso reaches the same /api surface from a shell.
BIN_DIR="${MSO_BIN_DIR:-$HOME/.local/bin}"
mkdir -p "$BIN_DIR"
ln -sfn "$DIR/bin/mso" "$BIN_DIR/mso"
ok "cli → $BIN_DIR/mso"

# Make the command available to the PARENT shell immediately after curl|bash returns.
# A child installer cannot export PATH back into its parent. /usr/local/bin is already
# on the normal system PATH, so install a second launcher there when the name is free
# (or already ours). Never overwrite an unrelated system command.
if [ "$DO_SERVICE" -eq 1 ]; then
  SYSTEM_CLI=/usr/local/bin/mso
  if [ ! -e "$SYSTEM_CLI" ] && [ ! -L "$SYSTEM_CLI" ]; then
    sudo_do ln -s "$DIR/bin/mso" "$SYSTEM_CLI"
    ok "system cli → $SYSTEM_CLI"
  elif [ -L "$SYSTEM_CLI" ]; then
    current_cli="$(readlink "$SYSTEM_CLI")"
    case "$current_cli" in
      "$DIR/"*) sudo_do ln -sfn "$DIR/bin/mso" "$SYSTEM_CLI"; ok "system cli → $SYSTEM_CLI" ;;
      *) warn "$SYSTEM_CLI already points elsewhere ($current_cli) — left untouched" ;;
    esac
  else
    warn "$SYSTEM_CLI already exists and is not a symlink — left untouched"
  fi
else
  info "--no-service: skipped /usr/local/bin launcher (user CLI still at $BIN_DIR/mso)"
fi

# A fresh distro often omits ~/.local/bin from PATH. Persist one small idempotent
# block for future shells, and export it now so onboarding can invoke `mso`.
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
  case "${SHELL:-}" in
    */bash) path_block "$HOME/.bashrc" ;;
    */zsh)  path_block "$HOME/.zshrc" ;;
  esac
else
  warn "custom MSO_BIN_DIR=$BIN_DIR is not written into shell profiles; add it to PATH yourself"
fi
export PATH="$BIN_DIR:$PATH"
command -v mso >/dev/null 2>&1 || die "CLI symlink exists but is not executable: $BIN_DIR/mso"
ok "mso command ready ($(command -v mso))"

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

ok "mso installed at $DIR"
cat <<EOF

  Open:     $REACH
  Env:      $DIR/.env.local
EOF
[ -n "$GEN_PW" ] && printf '  Password: %s   (shown once — save it now; edit OS_LOGIN_PASSWORD in .env.local + restart to change)\n' "$GEN_PW"

# A successful fresh install should lead directly into a usable product. curl|bash
# owns stdin, so interactive setup uses the controlling terminal explicitly.
RUN_ONBOARD=0
case "$ONBOARD_MODE" in
  always) RUN_ONBOARD=1 ;;
  never) RUN_ONBOARD=0 ;;
  auto) [ "$FRESH_INSTALL" -eq 1 ] && RUN_ONBOARD=1 ;;
esac
if [ "$RUN_ONBOARD" -eq 1 ] && [ "$DO_SERVICE" -eq 1 ]; then
  if [ "$YES" -eq 1 ]; then
    echo
    info "running minimal non-interactive onboarding (-y)…"
    "$BIN_DIR/mso" onboard -y || warn "onboarding did not finish — rerun: mso onboard"
  elif [ -r /dev/tty ] && [ -w /dev/tty ]; then
    echo
    info "starting guided onboarding…"
    if ! "$BIN_DIR/mso" onboard </dev/tty >/dev/tty 2>/dev/tty; then
      warn "onboarding stopped early — resume anytime with: mso onboard"
    fi
  else
    echo
    warn "no interactive terminal detected — onboarding skipped. Run: mso onboard"
  fi
elif [ "$RUN_ONBOARD" -eq 1 ]; then
  warn "--no-service leaves no running API to configure — run 'mso onboard' after starting MSO"
fi
cat <<EOF

  Pair your first device (device approval is a browser allowlist, not standards-based 2FA):
    1. Open the URL, enter the password — the browser lands PENDING and shows a device id.
    2. On this server:
         node $DIR/scripts/approve-device.js --list                 # see the pending id
         node $DIR/scripts/approve-device.js <deviceId> "my phone"  # approve it
    3. Reload + log in. Approve later devices from Settings → Devices.

  Logs:     journalctl -u mso -f
  Update:   re-run this installer (pull + rebuild + restart), or --uninstall to remove
  Listen:   $BIND:$PORT   (change with --bind / MSO_BIND)
  Security: verify from OUTSIDE the box — \`curl -m5 http://<public-ip>:$PORT/api/health\`
            run on your laptop is the only test that proves what is reachable.
            Review ~/.mso/audit.log.
EOF
