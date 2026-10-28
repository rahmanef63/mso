#!/usr/bin/env bash
# Scriptable agent verbs: `run` (one autonomous turn), `session` (session records
# without a TUI) and `stats --usage` (the session token/compaction ledger).
# Sourced by scripts/cli/runtime.sh, which sources mso-cli-agent.sh first.
#
# All three are thin adapters over the SAME agent loop and stores the interactive
# `mso agent` uses, so a scripted run cannot drift from what a human gets.
# shellcheck disable=SC2154

# `mso run "…"` — non-interactive twin of `mso agent`. Each flag is validated here
# because a mistyped scope must fail before any provider call is paid for; the
# attached-file limits themselves stay in the agent's one-shot parser.
run_agent_run() {
  local prompt="" args=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --json) args+=(--json); shift ;;
      --approve-scope)
        case "${2-}" in
          read|write|exec) args+=(--approve-scope "$2"); shift 2 ;;
          *) die "--approve-scope must be read, write, or exec" ;;
        esac ;;
      --continue|-c)
        # No value follows: the prompt is a positional arg. Shifting once here used
        # to swallow it as a resume ref.
        args+=(--continue); shift ;;
      --resume|-r)
        [ -n "${2-}" ] || die "--resume needs a session reference (latest|id|title)"
        args+=(--resume "$2"); shift 2 ;;
      --file|-f)
        # Attached-file semantics live in the agent's one-shot parser (size caps,
        # stdin-once rules); this adapter only forwards.
        [ -n "${2-}" ] || die "usage: mso $U_run"
        args+=(--file "$2"); shift 2 ;;
      --thinking) args+=(--thinking); shift ;;
      -*) die "unexpected flag for 'mso run': $1   (usage: mso $U_run)" ;;
      *)
        [ -z "$prompt" ] || die "mso run takes ONE prompt; quote it: mso run \"…\""
        prompt="$1"; shift ;;
    esac
  done
  [ -n "$prompt" ] || die "usage: mso $U_run"
  # run_agent() is the same entry point `mso agent` uses; it validates the prompt,
  # ensures provider/model readiness, then execs the shared agent runtime.
  run_agent --oneshot "$prompt" "${args[@]}"
}

# Resolve a session reference without duplicating the server's id/name/latest logic.
__mso_session_ref() {
  local ref="${1:-latest}" id
  if [ "$ref" = latest ]; then
    id=$(jget "/api/v1/agent-sessions?limit=1" | jq -r '.sessions[0].id // empty')
    [ -n "$id" ] || die "no agent sessions yet"
    printf '%s' "$id"
  else printf '%s' "$ref"; fi
}

run_agent_session() {
  case "${1:-list}" in
    list)
      jget "/api/v1/agent-sessions?limit=$(enc "${2:-30}")" |
        jq -r '(.sessions // [])[] | "\(.id)\t\(.source)\t\(.updatedAt)\t\(.historyTurns)t\t\(.estimatedTokens)tk\t\(.title)"' ;;
    show)
      ref=$(__mso_session_ref "${2-latest}")
      jget "/api/v1/agent-sessions?ref=$(enc "$ref")" ;;
    export)
      # Flags can come before or without a ref: `export --out f` means "latest".
      ref="latest"; out=""
      local a="${2-}"
      while [ -n "$a" ]; do
        case "$a" in
          --out) out="${3:?--out needs a file}"; shift 2; a="${2-}" ;;
          *) ref="$a"; shift; a="${2-}" ;;
        esac
      done
      ref=$(__mso_session_ref "$ref")
      if [ -n "$out" ]; then
        jget "/api/v1/agent-sessions?ref=$(enc "$ref")" > "$out"
        echo "wrote $out" >&2
      else jget "/api/v1/agent-sessions?ref=$(enc "$ref")"; fi ;;
    import)
      src=""; title=""
      local a="${2-}"
      while [ -n "$a" ]; do
        case "$a" in
          --title) title="${3:?--title needs a value}"; shift 2; a="${2-}" ;;
          *) [ -z "$src" ] || die "import takes ONE file; quote it"; src="$a"; shift; a="${2-}" ;;
        esac
      done
      [ -n "$src" ] || die "usage: mso $U_session"
      if [ "$src" = - ]; then body=$(cat); else [ -f "$src" ] || die "no such file: $src"; body=$(cat -- "$src"); fi
      printf '%s' "$body" | jq -e '(.session.history // .history) | type == "array"' >/dev/null 2>&1 \
        || die "$src is not a session export (no history array)"
      # Import replays the recorded history into a NEW session. Reusing the source
      # id would let a foreign export overwrite a live conversation.
      history=$(printf '%s' "$body" | jq -c '.session.history // .history')
      fallback_title=$(printf '%s' "$body" | jq -r '.session.title // "Imported session"' | cut -c1-120)
      created=$(jpost "/api/v1/agent-sessions" "$(jq -nc --arg t "${title:-$fallback_title}" '{action:"create",title:$t}')")
      new_id=$(printf '%s' "$created" | jq -r '.session.id // empty')
      [ -n "$new_id" ] || die "server did not return a session id"
      jpost "/api/v1/agent-sessions" "$(jq -nc --arg id "$new_id" --argjson h "$history" '{action:"update",id:$id,history:$h}')" >/dev/null
      printf '%s\n' "$created" ;;
    rm|delete)
      # The session API has no delete action; say so instead of pretending.
      die "mso session rm: the agent-session store is append-only over the API. Archive instead: mso agent-sessions show $(__mso_session_ref "${2-latest}")" ;;
    *) die "usage: mso $U_session" ;;
  esac
}

# `mso stats --usage` — what opencode's `stats --cost/--models` gives, from the
# records MSO already stores: per-session estimated tokens, compaction, archives.
run_agent_stats() {
  json=0; days=0; models=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --json) json=1; shift ;;
      --models) models=1; shift ;;
      --usage) shift ;;
      --days) [ -n "${2-}" ] && [[ "$2" =~ ^[0-9]+$ ]] || die "--days needs a whole number"; days="$2"; shift 2 ;;
      *) die "usage: mso $U_stats" ;;
    esac
  done
  data=$(jget "/api/v1/agent-sessions?limit=200")
  if [ "$days" -gt 0 ]; then
    cutoff=$(date -u -d "-$days days" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-"${days}"d +%Y-%m-%dT%H:%M:%SZ)
    data=$(printf '%s' "$data" | jq --arg c "$cutoff" '.sessions |= [.[] | select(.updatedAt >= $c)]')
  fi
  if [ "$json" = 1 ]; then
    printf '%s' "$data" | jq '{sessions: (.sessions|length), tokens: ([.sessions[].estimatedTokens]|add // 0), lifetimeTokens: ([.sessions[].lifetimeEstimatedTokens]|add // 0), turns: ([.sessions[].historyTurns]|add // 0), compactions: ([.sessions[].compactionCount]|add // 0), archives: ([.sessions[].archiveCount]|add // 0), bySource: ([.sessions[].source]|group_by(.)|map({source:.[0],count:length}))}'
    return 0
  fi
  printf '%s' "$data" | jq -r '
    "sessions      \(.sessions|length)",
    "tokens now    \(([.sessions[].estimatedTokens]|add // 0))",
    "tokens total  \(([.sessions[].lifetimeEstimatedTokens]|add // 0))",
    "turns         \(([.sessions[].historyTurns]|add // 0))",
    "compactions   \(([.sessions[].compactionCount]|add // 0))",
    "archives      \(([.sessions[].archiveCount]|add // 0))",
    "",
    "by source",
    (([.sessions[].source] // []) | group_by(.) | map("  \(.[0])\t\(length)") | .[])'
  if [ "$models" = 1 ]; then
    # Per-model cost is not recorded per session yet; name the gap, do not invent it.
    echo
    echo "per-model cost: not recorded — sessions store estimated tokens, not provider/model attribution."
  fi
}
