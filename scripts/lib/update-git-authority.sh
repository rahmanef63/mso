#!/usr/bin/env bash
# Classify one checkout against its fetched origin/main without mutating history.
# Output: <exact|behind|ahead|diverged> <ahead-count> <behind-count>

update_git_relation() {
  local root="$1" head remote ahead behind relation
  head="$(git -C "$root" rev-parse HEAD 2>/dev/null || true)"
  remote="$(git -C "$root" rev-parse origin/main 2>/dev/null || true)"
  [[ "$head" =~ ^[0-9a-f]{40}$ ]] && [[ "$remote" =~ ^[0-9a-f]{40}$ ]] || return 1
  ahead="$(git -C "$root" rev-list --count origin/main..HEAD 2>/dev/null || true)"
  behind="$(git -C "$root" rev-list --count HEAD..origin/main 2>/dev/null || true)"
  [[ "$ahead" =~ ^[0-9]+$ ]] && [[ "$behind" =~ ^[0-9]+$ ]] || return 1
  if [ "$ahead" -eq 0 ] && [ "$behind" -eq 0 ]; then relation=exact
  elif [ "$ahead" -eq 0 ]; then relation=behind
  elif [ "$behind" -eq 0 ]; then relation=ahead
  else relation=diverged
  fi
  printf '%s %s %s\n' "$relation" "$ahead" "$behind"
}
