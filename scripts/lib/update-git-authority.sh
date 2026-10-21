#!/usr/bin/env bash
# Classify one checkout against an update target without mutating history.
# Output: <exact|behind|ahead|diverged> <ahead-count> <behind-count>

# Target may be origin/main (rolling channel) or a release tag resolved by the
# caller. It is always a value this repository produced, never request input.
update_git_relation_to() {
  local root="$1" target="$2" head remote ahead behind relation
  head="$(git -C "$root" rev-parse HEAD 2>/dev/null || true)"
  remote="$(git -C "$root" rev-parse "$target" 2>/dev/null || true)"
  [[ "$head" =~ ^[0-9a-f]{40}$ ]] && [[ "$remote" =~ ^[0-9a-f]{40}$ ]] || return 1
  ahead="$(git -C "$root" rev-list --count "$target"..HEAD 2>/dev/null || true)"
  behind="$(git -C "$root" rev-list --count HEAD.."$target" 2>/dev/null || true)"
  [[ "$ahead" =~ ^[0-9]+$ ]] && [[ "$behind" =~ ^[0-9]+$ ]] || return 1
  if [ "$ahead" -eq 0 ] && [ "$behind" -eq 0 ]; then relation=exact
  elif [ "$ahead" -eq 0 ]; then relation=behind
  elif [ "$behind" -eq 0 ]; then relation=ahead
  else relation=diverged
  fi
  printf '%s %s %s\n' "$relation" "$ahead" "$behind"
}

update_git_relation() {
  update_git_relation_to "$1" origin/main
}

# Highest release tag reachable from origin/main, or empty when none exists.
# The tag grammar is the SAME allowlist lib/host/self-update-channel.ts applies, and
# a tag that does not match is dropped rather than quoted: it would become argv.
update_git_latest_release_tag() {
  local root="$1" tags tag best best_parts parts
  tags="$(git -C "$root" tag --merged origin/main --list 'v*' 2>/dev/null || true)"
  best=""
  while IFS= read -r tag; do
    [ -n "$tag" ] || continue
    printf '%s\n' "$tag" | grep -Eq '^v?[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$' || continue
    if [ -z "$best" ]; then best="$tag"; continue; fi
    if [ "$(printf '%s\n%s\n' "$best" "$tag" | sort -V | tail -1)" = "$tag" ] && [ "$tag" != "$best" ]; then
      best="$tag"
    fi
  done <<<"$tags"
  printf '%s' "$best"
}

# Resolve the channel enum into a concrete Git ref. Prints ONLY the ref on stdout
# (it is consumed by command substitution) and sets UPDATE_TARGET_FALLBACK=1 when
# stable had no release tag and is therefore tracking rolling main, so the caller
# decides where that is said out loud.
#   main   → origin/main                      (rolling, unchanged)
#   stable → highest release tag on origin/main; origin/main ONLY when no tag exists
UPDATE_TARGET_FALLBACK="${UPDATE_TARGET_FALLBACK:-0}"
update_git_resolve_target() {
  local root="$1" channel="$2" tag
  UPDATE_TARGET_FALLBACK=0
  case "$channel" in
    main)
      printf 'origin/main' ;;
    stable)
      tag="$(update_git_latest_release_tag "$root")"
      if [ -n "$tag" ]; then
        printf '%s' "$tag"
      else
        UPDATE_TARGET_FALLBACK=1
        printf 'origin/main'
      fi ;;
    *)
      printf 'unknown update channel: %s\n' "$channel" >&2
      return 1 ;;
  esac
}

# Human note for a resolved target. Empty for rolling main on the main channel.
update_channel_note() {
  local channel="$1" target="$2" fallback="${3:-0}"
  if [ "$target" != origin/main ]; then
    printf ' (%s channel, release %s)' "$channel" "$target"
  elif [ "$fallback" = 1 ] || [ "$channel" = stable ]; then
    printf ' (stable channel: no release tag exists yet, tracking origin/main)'
  fi
}
