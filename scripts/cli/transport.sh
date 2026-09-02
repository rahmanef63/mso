#!/usr/bin/env bash
# Local device, auth, HTTP and A2A transport helpers. Sourced by scripts/cli/runtime.sh.
# ── local ops (no HTTP, no login) ───────────────────────────────────────────
# These edit ~/.mso/auth-devices.json on THIS machine. They are deliberately local
# (they must keep working while the service is down) — but that makes them the one
# family of verbs `--base` does not follow. Pointing at a remote host and running
# `device approve` used to silently edit the LOCAL allowlist and report success,
# so the operator believed they had approved a device that was still pending.
dev_script() {
  case "$B" in
    http://127.0.0.1:*|http://localhost:*|http://[::1]:*) ;;
    *) die "device commands edit the LOCAL allowlist (~/.mso/auth-devices.json) and cannot reach $B.
  Run them ON that host, or over ssh:  ssh <host> mso device $*" ;;
  esac
  node "$ROOT/scripts/approve-device.js" "$@"
}

# ── auth ────────────────────────────────────────────────────────────────────
PASS="${MSO_PASSWORD:-${OS_PASSWORD:-${OS_LOGIN_PASSWORD:-}}}"
DEV="${MSO_DEVICE:-${OS_DEVICE:-}}"
# A stable per-host CLI device id, so `mso approve` only ever has to run once.
DEVF="${MSO_DEVICE_FILE:-$HOME/.mso/cli.device.id}"
cli_device() {
  [ -n "$DEV" ] && { printf '%s' "$DEV"; return; }
  [ -s "$DEVF" ] || { mkdir -p "$(dirname "$DEVF")"; head -c16 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$DEVF"; chmod 600 "$DEVF"; }
  cat "$DEVF"
}

# Jar is per-base as well as per-user: switching --base must not reuse a cookie
# minted for a different origin. Live bearer material belongs only in an owner-only
# directory, never a predictable shared /tmp name.
PRIVATE_STATE_ROOT="${MSO_PRIVATE_STATE_DIR:-$HOME/.mso/private}"
BASE_KEY=$(printf '%s' "$B" | sha256sum | cut -c1-32)
JAR_REQUESTED="${MSO_JAR:-$PRIVATE_STATE_ROOT/cli/cookies/$BASE_KEY.jar}"
JAR=$(mso_private_state_ensure_file "$JAR_REQUESTED") || die "refusing unsafe cookie jar: $JAR_REQUESTED"

# proxy.ts blocks mutating /api requests that can't prove same-origin. A browser
# proves it with Sec-Fetch-Site; the documented fallback for non-browser clients
# is an Origin whose host matches the Host header — which is exactly what $B is.
# Sent on every call so `login` works before any session cookie exists.
ORIGIN=(-H "origin: $B")

login() {
  local d out code body; d=$(cli_device)
  [ -n "$PASS" ] || die "no OS_LOGIN_PASSWORD in $ENVF (or export MSO_PASSWORD)"
  JAR=$(mso_private_state_ensure_file "$JAR") || die "refusing unsafe cookie jar: $JAR"
  out=$(jq -n --arg p "$PASS" --arg d "$d" '{password:$p,deviceId:$d,deviceLabel:"mso cli"}' \
    | curl -sS -w $'\n%{http_code}' -c "$JAR" -X POST "$B/api/auth/login" \
      "${ORIGIN[@]}" -H 'content-type: application/json' -d @- 2>/dev/null || true)
  code="${out##*$'\n'}"; body="${out%$'\n'*}"
  [ "$code" = "200" ] && return 0
  case "$code" in
    000|"") die "MSO runtime is not reachable at $B. Run: mso web   (local UI) or mso gateway start   (temporary public HTTPS)" ;;
    403) die "device is not approved by the running MSO instance. Check: mso device pending ; then approve the exact id with: mso device approve $d \"mso cli\"" ;;
    401) die "login password was rejected by the running MSO instance" ;;
    429) die "login is rate-limited; retry after the server window resets" ;;
    500) die "running MSO auth is not configured correctly; run: mso doctor" ;;
    *) die "login failed ($code): ${body:-no response body}; run: mso doctor" ;;
  esac
}

# Request with the cached cookie; on 401/403 (expired) log in once and retry.
# Login is lazy on purpose: `mso -h`, `mso device …` and `mso service …` are
# local-only and must keep working while the service is down or unapproved.
req() {
  local out code body
  JAR=$(mso_private_state_ensure_file "$JAR") || die "refusing unsafe cookie jar: $JAR"
  [ -s "$JAR" ] || login
  JAR=$(mso_private_state_validate_file "$JAR") || die "refusing unsafe cookie jar: $JAR"
  out=$(curl -sS -b "$JAR" "${ORIGIN[@]}" -w $'\n%{http_code}' "$@" || true)
  code="${out##*$'\n'}"; body="${out%$'\n'*}"
  if [ "$code" = "401" ] || [ "$code" = "403" ]; then
    login
    JAR=$(mso_private_state_validate_file "$JAR") || die "refusing unsafe cookie jar: $JAR"
    out=$(curl -sS -b "$JAR" "${ORIGIN[@]}" -w $'\n%{http_code}' "$@" || true)
    code="${out##*$'\n'}"; body="${out%$'\n'*}"
  fi
  case "$code" in 2*) printf '%s' "$body" ;; *) die "request failed ($code): $body" ;; esac
}
# Binary-safe variant: streams straight to stdout, no capture, no code check.
reqraw() {
  JAR=$(mso_private_state_ensure_file "$JAR") || die "refusing unsafe cookie jar: $JAR"
  [ -s "$JAR" ] || login
  JAR=$(mso_private_state_validate_file "$JAR") || die "refusing unsafe cookie jar: $JAR"
  curl -fsS -b "$JAR" "${ORIGIN[@]}" "$@"
}

enc()   { jq -rn --arg v "$1" '$v|@uri'; }
jget()  { req "$B$1"; }
jpost() { req -H 'content-type: application/json' -d "${2:-{\}}" "$B$1"; }
jdel()  { req -X DELETE -H 'content-type: application/json' -d "${2:-{\}}" "$B$1"; }
# Build a JSON object from k=v pairs (numbers + booleans coerced).
kv_args() { local j='{}' kv k v; for kv in "$@"; do k="${kv%%=*}"; v="${kv#*=}"
  if [[ "$v" =~ ^-?[0-9]+([.][0-9]+)?$ || "$v" == "true" || "$v" == "false" ]]; then
    j=$(jq -c --arg k "$k" --argjson v "$v" '.+{($k):$v}' <<<"$j")
  else j=$(jq -c --arg k "$k" --arg v "$v" '.+{($k):$v}' <<<"$j"); fi; done; printf '%s' "$j"; }
json_arg() { jq -e . >/dev/null 2>&1 <<<"${1-}" || die "not valid JSON: ${1-}"; printf '%s' "$1"; }

# POST a JSON value that may contain a credential without putting the JSON in
# curl's argv. We force a fresh login first so there is no retry that would need to
# replay consumed stdin. The body exists only in this shell process and the pipe.
secret_post() {
  local route="$1" body="$2" out code payload
  login
  JAR=$(mso_private_state_validate_file "$JAR") || die "refusing unsafe cookie jar: $JAR"
  out=$(printf '%s' "$body" | curl -sS -b "$JAR" "${ORIGIN[@]}" -w $'\n%{http_code}' \
    -H 'content-type: application/json' -d @- "$B$route" || true)
  code="${out##*$'\n'}"; payload="${out%$'\n'*}"
  case "$code" in 2*) printf '%s' "$payload" ;; *) die "request failed ($code): $payload" ;; esac
}

# Build an outbound A2A credential JSON body while keeping the secret off process argv.
# Non-secret metadata travels in env vars; the secret is read only from stdin.
a2a_credential_body() {
  local agent_id="$1" label="$2" kind="$3" header_name="${4-}" scheme_name="${5-}"
  A2A_AGENT_ID="$agent_id" A2A_LABEL="$label" A2A_KIND="$kind" A2A_HEADER_NAME="$header_name" A2A_SCHEME_NAME="$scheme_name" node -e '
    let secret=""; process.stdin.setEncoding("utf8"); process.stdin.on("data",d=>secret+=d); process.stdin.on("end",()=>{
      const body={action:"credential-create",agentId:process.env.A2A_AGENT_ID,label:process.env.A2A_LABEL,kind:process.env.A2A_KIND,secret,activate:true};
      if(process.env.A2A_HEADER_NAME) body.headerName=process.env.A2A_HEADER_NAME;
      if(process.env.A2A_SCHEME_NAME) body.schemeName=process.env.A2A_SCHEME_NAME;
      process.stdout.write(JSON.stringify(body));
    });'
}

a2a_agent_id() {
  local ref="$1" found
  found="$(jget "/api/v1/a2a" | jq -r --arg q "${ref,,}" '[.agents[] | select((.id|ascii_downcase)==$q or (.alias|ascii_downcase)==$q or (.card.name|ascii_downcase)==$q)] | if length==1 then .[0].id else empty end')"
  [ -n "$found" ] || die "A2A peer not found or ambiguous: $ref"
  printf '%s' "$found"
}

a2a_agent_schemes() {
  local agent_id="$1"
  jget "/api/v1/a2a" | jq -r --arg id "$agent_id" '.agents[] | select(.id==$id) | .card.securitySchemeNames[]?'
}

a2a_agent_scheme_json() {
  local agent_id="$1" scheme_name="$2"
  jget "/api/v1/a2a" | jq -c --arg id "$agent_id" --arg scheme "$scheme_name" '.agents[] | select(.id==$id) | (.card.securitySchemes[$scheme] // {})'
}
