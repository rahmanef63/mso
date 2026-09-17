#!/usr/bin/env bash
# Cloudflare edge readiness and Quick Tunnel discovery. Loaded only by the provider adapter.

# Cloudflare Quick Tunnel readiness discovery stays inside the adapter.
gateway_discover_quick_url() {
  local pid i
  pid="$(jq -r .pid <<<"$TUNNEL_IDENTITY")"
  for i in $(seq 1 80); do
    GATEWAY_PUBLIC_URL="$(grep -Eo 'https://[A-Za-z0-9-]+\.trycloudflare\.(com|app)' "$PROVIDER_LOG" | tail -1 || true)"
    [ -n "$GATEWAY_PUBLIC_URL" ] && return 0
    # Startup may legitimately exec an interpreter before publishing the URL.
    # Pin the spawned lifetime here; require exact executable/argv after readiness.
    [ "$(gateway_proc_start_ticks "$pid" 2>/dev/null || true)" = "$TUNNEL_PENDING_TICKS" ] || return 1
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
