#!/usr/bin/env bash
# Cloudflare tunnel start path. The application port always remains loopback-only.

gateway_parse_start_args() {
  GATEWAY_CONFIG=""; GATEWAY_TUNNEL=""; GATEWAY_MODE=temporary; GATEWAY_PROVIDER=cloudflare-quick
  shift || true
  while [ $# -gt 0 ]; do
    case "$1" in
      --config) [ -n "${2-}" ] || gateway_fail "--config needs a path"; GATEWAY_CONFIG="$2"; shift 2 ;;
      --tunnel) [ -n "${2-}" ] || gateway_fail "--tunnel needs a name or UUID"; GATEWAY_TUNNEL="$2"; shift 2 ;;
      *) gateway_fail "usage: mso gateway start [--config <cloudflared.yml> --tunnel <name|uuid>]" ;;
    esac
  done
}

gateway_validate_named_config() {
  node - "$ROOT" "$GATEWAY_CONFIG" "$GATEWAY_PUBLIC_URL" "$LOCAL_URL" <<'NODE'
const fs = require('fs');
const path = require('path');
const [root, file, publicOrigin, localOrigin] = process.argv.slice(2);
let YAML;
try { YAML = require(path.join(root, 'node_modules/yaml')); } catch { process.exit(10); }
let cfg;
try { cfg = YAML.parse(fs.readFileSync(file, 'utf8')); } catch { process.exit(11); }
if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) process.exit(12);
const ingress = cfg.ingress;
if (!Array.isArray(ingress) || ingress.length !== 2) process.exit(13);
const publicHost = new URL(publicOrigin).hostname.toLowerCase();
const local = new URL(localOrigin);
const loopback = (host) => host === 'localhost' || host === '::1' || host === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(host);
const first = ingress[0], last = ingress[1];
if (!first || typeof first !== 'object' || String(first.hostname || '').toLowerCase() !== publicHost) process.exit(14);
let service;
try { service = new URL(String(first.service || '')); } catch { process.exit(15); }
if (service.protocol !== 'http:' || !loopback(service.hostname) || service.port !== local.port || service.pathname !== '/' || service.search || service.hash) process.exit(16);
if (!last || typeof last !== 'object' || Object.keys(last).some((k) => k !== 'service') || last.service !== 'http_status:404') process.exit(17);
const rawCred = cfg['credentials-file'];
if (typeof rawCred !== 'string' || !rawCred.trim()) process.exit(18);
let cred = rawCred.trim();
if (cred.startsWith('~/')) cred = path.join(process.env.HOME || '', cred.slice(2));
if (!path.isAbsolute(cred)) cred = path.resolve(path.dirname(file), cred);
let st;
try { st = fs.lstatSync(cred); } catch { process.exit(19); }
if (!st.isFile() || st.isSymbolicLink() || st.uid !== process.getuid() || (st.mode & 0o077) !== 0) process.exit(20);
NODE
}

gateway_validate_named_tunnel() {
  local mode public
  [ -n "$GATEWAY_CONFIG" ] && [ -n "$GATEWAY_TUNNEL" ] || gateway_fail "named mode requires BOTH --config and --tunnel"
  [[ "$GATEWAY_TUNNEL" =~ ^[A-Za-z0-9_-]{1,80}$ ]] || gateway_fail "invalid tunnel name/UUID"
  [ -f "$GATEWAY_CONFIG" ] && [ ! -L "$GATEWAY_CONFIG" ] || gateway_fail "config must be a regular non-symlink file"
  [ "$(stat -c '%u' "$GATEWAY_CONFIG")" = "$(id -u)" ] || gateway_fail "cloudflared config must be owned by current user"
  mode="$(stat -c '%a' "$GATEWAY_CONFIG")"; (( (8#$mode & 022) == 0 )) \
    || gateway_fail "cloudflared config must not be group/world-writable (got mode $mode)"
  public="$(gateway_validate_public_origin "${OS_PUBLIC_ORIGIN:-}" 2>/dev/null || true)"
  [ -n "$public" ] || gateway_fail "named mode requires OS_PUBLIC_ORIGIN=https://your-domain (use: mso gateway domain set https://...)"
  GATEWAY_MODE=named; GATEWAY_PROVIDER=cloudflare-named; GATEWAY_PUBLIC_URL="$public"
  gateway_validate_named_config || gateway_fail "named config must be dedicated to OS_PUBLIC_ORIGIN -> the MSO loopback port, end in http_status:404, and reference a private owner-owned credentials-file"
}

gateway_spawn_tunnel() {
  local pid identity
  gateway_private_file "$CF_LOG"; : >"$CF_LOG"
  # The parent intentionally has OS_LOGIN_PASSWORD, session secrets and BYOK keys
  # for the Next runtime. The held-child helper scrubs that environment and cannot
  # exec cloudflared until this parent has persisted the child lifetime identity.
  if [ "$GATEWAY_MODE" = temporary ]; then
    [ -z "${OS_PUBLIC_ORIGIN:-}" ] || gateway_info "warning: temporary gateway leaves existing OS_PUBLIC_ORIGIN unchanged"
    gateway_spawn_held_tunnel "$CLOUDFLARED" tunnel --no-autoupdate --url "$LOCAL_URL" || return 1
    pid="$TUNNEL_SPAWN_PID"
    identity="$(gateway_wait_spawn_identity "$pid" "$CLOUDFLARED" tunnel --no-autoupdate --url "$LOCAL_URL" 2>/dev/null || true)"
  else
    gateway_spawn_held_tunnel "$CLOUDFLARED" tunnel --config "$GATEWAY_CONFIG" --no-autoupdate run "$GATEWAY_TUNNEL" || return 1
    pid="$TUNNEL_SPAWN_PID"
    identity="$(gateway_wait_spawn_identity "$pid" "$CLOUDFLARED" tunnel --config "$GATEWAY_CONFIG" --no-autoupdate run "$GATEWAY_TUNNEL" 2>/dev/null || true)"
  fi
  [ -n "$identity" ] || { gateway_stop_pending_tunnel; return 1; }
  gateway_pending_gate_cleanup
  TUNNEL_IDENTITY="$identity"
  TUNNEL_PENDING_PID=0; TUNNEL_PENDING_TICKS=''
  GATEWAY_PENDING_CLEANUP=1
}

gateway_discover_quick_url() {
  local pid i
  pid="$(jq -r .pid <<<"$TUNNEL_IDENTITY")"
  for i in $(seq 1 80); do
    GATEWAY_PUBLIC_URL="$(grep -Eo 'https://[A-Za-z0-9-]+\.trycloudflare\.(com|app)' "$CF_LOG" | tail -1 || true)"
    [ -n "$GATEWAY_PUBLIC_URL" ] && return 0
    gateway_identity_matches_retry "$TUNNEL_IDENTITY" || return 1
    sleep 0.25
  done
  return 1
}

gateway_quick_public_ipv4s() {
  local host response
  host="$(node - "$GATEWAY_PUBLIC_URL" <<'NODE'
try {
  const u = new URL(process.argv[2]);
  if (u.protocol !== 'https:' || !/^[A-Za-z0-9-]+\.trycloudflare\.(?:com|app)$/.test(u.hostname)) process.exit(1);
  process.stdout.write(u.hostname);
} catch { process.exit(1); }
NODE
)" || return 1
  response="$("$CURL" -fsS --max-time 5 -H 'accept: application/dns-json' \
    "https://cloudflare-dns.com/dns-query?name=$host&type=A" 2>/dev/null || true)"
  [ -n "$response" ] || return 1
  jq -r '.Answer[]? | select(.type == 1) | .data' <<<"$response" 2>/dev/null \
    | node -e '
      const net=require("net"), readline=require("readline");
      const blocked=(ip)=>{const p=ip.split(".").map(Number); return p[0]===0||p[0]===10||p[0]===127||p[0]>=224||
        (p[0]===169&&p[1]===254)||(p[0]===172&&p[1]>=16&&p[1]<=31)||(p[0]===192&&p[1]===168)||
        (p[0]===100&&p[1]>=64&&p[1]<=127)||(p[0]===198&&(p[1]===18||p[1]===19));};
      const rl=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
      rl.on("line",ip=>{ip=ip.trim(); if(net.isIP(ip)===4&&!blocked(ip)) console.log(ip);});'
}

gateway_quick_edge_health_ok() {
  local host ip body
  [ "$GATEWAY_MODE" = temporary ] || return 1
  host="${GATEWAY_PUBLIC_URL#https://}"
  while IFS= read -r ip; do
    [ -n "$ip" ] || continue
    # --resolve bypasses only the caller's DNS cache. TLS still verifies the
    # random trycloudflare hostname, and the body must match this launch's nonce.
    body="$("$CURL" -fsS --max-time 5 --resolve "$host:443:$ip" \
      "$GATEWAY_PUBLIC_URL/api/health" 2>/dev/null || true)"
    gateway_health_body_matches_identity "$body" "$LOCAL_HEALTH_IDENTITY" && return 0
  done < <(gateway_quick_public_ipv4s || true)
  return 1
}

gateway_probe_public() {
  local seconds="${MSO_GATEWAY_PUBLIC_READY_SECONDS:-60}" i
  [ "${MSO_GATEWAY_SKIP_PUBLIC_PROBE:-0}" = 1 ] && return 0
  [[ "$seconds" =~ ^[0-9]+$ ]] && [ "$seconds" -ge 10 ] && [ "$seconds" -le 120 ] \
    || gateway_fail "MSO_GATEWAY_PUBLIC_READY_SECONDS must be an integer from 10 to 120"
  # A newly allocated Quick Tunnel hostname can exist before the edge route has
  # propagated. Do not weaken the MSO health/instance check; give the provider a
  # bounded readiness window instead. Named tunnels usually pass on the first poll.
  for i in $(seq 1 "$seconds"); do
    gateway_health_url_matches_identity "$GATEWAY_PUBLIC_URL" "$LOCAL_HEALTH_IDENTITY" && return 0
    gateway_quick_edge_health_ok && return 0
    sleep 1
  done
  return 1
}

gateway_cleanup_failed_start() {
  if [ "${TUNNEL_IDENTITY:-null}" != null ]; then gateway_stop_identity "$TUNNEL_IDENTITY"
  else gateway_stop_pending_tunnel; fi
  if [ "${RUNTIME_STARTED_NOW:-false}" = true ]; then gateway_stop_identity "$RUNTIME_IDENTITY"
  else gateway_stop_pending_runtime; fi
}

gateway_cmd_start_locked() {
  local state active rc
  if active="$(gateway_active_state)"; then gateway_cmd_status; return 0; else rc=$?; fi
  [ "$rc" = 1 ] || return "$rc"
  [ -z "$GATEWAY_CONFIG$GATEWAY_TUNNEL" ] || gateway_validate_named_tunnel
  gateway_resolve_cloudflared

  state="$(gateway_state_read)"
  gateway_assert_port_loopback_only
  gateway_runtime_from_state "$state"
  gateway_start_runtime_if_needed
  gateway_assert_port_loopback_only
  LOCAL_HEALTH_IDENTITY="$(gateway_health_url_identity "$LOCAL_URL" "${RUNTIME_INSTANCE_ID:-}")" \
    || { gateway_cleanup_failed_start; gateway_fail "selected local runtime did not return a stable MSO health identity"; }
  TUNNEL_IDENTITY=null; GATEWAY_PUBLIC_URL="${GATEWAY_PUBLIC_URL:-}"
  gateway_spawn_tunnel || { gateway_cleanup_failed_start; gateway_fail "cloudflared failed to start with the expected argv"; }
  if [ "$GATEWAY_MODE" = temporary ]; then
    gateway_discover_quick_url || { gateway_cleanup_failed_start; gateway_fail "Quick Tunnel did not return a public URL; see $CF_LOG"; }
  fi
  GATEWAY_PUBLIC_URL="$(gateway_validate_public_origin "$GATEWAY_PUBLIC_URL" 2>/dev/null || true)"
  [ -n "$GATEWAY_PUBLIC_URL" ] || { gateway_cleanup_failed_start; gateway_fail "tunnel produced an invalid public origin"; }
  gateway_probe_public || { gateway_cleanup_failed_start; gateway_fail "public endpoint did not return the MSO health contract; see $CF_LOG"; }
  if ! gateway_write_state "$GATEWAY_PROVIDER" "$GATEWAY_MODE" "$GATEWAY_PUBLIC_URL" "$TUNNEL_IDENTITY"; then
    gateway_cleanup_failed_start
    gateway_fail "could not persist gateway state; newly launched processes were rolled back"
  fi
  GATEWAY_PENDING_CLEANUP=0

  gateway_info "gateway started"
  gateway_info "public: $GATEWAY_PUBLIC_URL"
  gateway_info "local:  $LOCAL_URL (still loopback-only)"
  [ "$GATEWAY_MODE" != temporary ] || gateway_info "warning: Quick Tunnel is preview-only; live Terminal SSE may not work"
  gateway_info "open:   mso web"
  gateway_info "stop:   mso gateway stop"
}
