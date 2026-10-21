// Opt-in unattended updates: the ONE pref shape plus its strict validator.
//
// This module is pure and alias-free on purpose: `scripts/self-update-auto.ts`
// (the timer entry point, run by bun) imports it through the gate module, so an
// `@/` specifier here would need tsconfig path resolution at runtime.
//
// The channel is a FIXED enum. No ref, path, tag, or command is ever accepted
// from a request — the client picks `stable` or `main` and the updater resolves
// the actual Git target server-side (lib/host/self-update-channel.ts).

export type UpdateChannel = "stable" | "main";

export const UPDATE_CHANNELS = ["stable", "main"] as const;

/** Persisted settings only. Runtime outcomes (last attempt, failures) are
 *  written by the updater to ~/.mso/auto-update-state.json, never by a client
 *  and never into this file — two writers on prefs.json would lose updates. */
export interface PrefUpdates {
  auto: boolean;
  channel: UpdateChannel;
}

/**
 * `main` by default, deliberately.
 *
 * `stable` was the planned default, but this repository's release tags lag far
 * behind the branch: v0.2.0 is an ancestor of HEAD with 1127 commits in between.
 * A tag-based default therefore reports "already up to date" on a checkout that is
 * a thousand commits ahead of its newest tag, which hides the update action
 * entirely — the exact symptom this work exists to remove. Following `main` is
 * also what every existing install did before channels existed, so keeping it the
 * default changes nobody's behaviour silently. `stable` is an explicit opt-in.
 */
export const UPDATE_PREF_DEFAULTS: PrefUpdates = { auto: false, channel: "main" };

export function parseUpdateChannel(value: unknown): UpdateChannel | null {
  return value === "stable" || value === "main" ? value : null;
}

/** Strict merge patch: unknown keys, wrong types and bad enum values are errors,
 *  not silently dropped, so a client cannot believe it enabled something. */
export function sanitizeUpdatesPatch(
  raw: unknown,
): { ok: true; patch: Partial<PrefUpdates> } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "updates must be an object" };
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length === 0) return { ok: false, error: "updates is empty" };
  const patch: Partial<PrefUpdates> = {};
  for (const [key, value] of entries) {
    if (key === "auto") {
      if (typeof value !== "boolean") return { ok: false, error: "updates.auto must be a boolean" };
      patch.auto = value;
    } else if (key === "channel") {
      const channel = parseUpdateChannel(value);
      if (!channel) return { ok: false, error: "updates.channel must be stable or main" };
      patch.channel = channel;
    } else {
      return { ok: false, error: `updates.${key} is not writable` };
    }
  }
  return { ok: true, patch };
}

/** Stored value → effective value, tolerating a hand-edited store. */
export function resolveUpdates(stored: unknown): PrefUpdates {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return { ...UPDATE_PREF_DEFAULTS };
  const row = stored as Record<string, unknown>;
  return {
    auto: row.auto === true,
    channel: parseUpdateChannel(row.channel) ?? UPDATE_PREF_DEFAULTS.channel,
  };
}
