"use client";

// Export / import of everything the shell keeps in localStorage — Playbooks,
// Agents, Automations, the window layout, the app registry, the desktop-icon
// arrangement, widget contents, per-shell wallpapers.
//
// CONTRACT.md documents the storage CHOICE; nobody documented the CONSEQUENCE.
// There is no server copy of any of it, so "Clear browsing data", a new laptop
// or a profile reset destroys it permanently with no undo. This file is the undo.

/**
 * WHICH KEYS ARE OURS — a prefix rule plus a short explicit allowlist.
 *
 * A flat hardcoded list of all ~30 keys is the obvious implementation and a trap:
 * the next feature that calls `localStorage.setItem` silently falls out of every
 * backup taken afterwards and NOTHING fails — the export succeeds, the user gets
 * a .json, and the loss surfaces only during the restore that was meant to save
 * them. A prefix rule catches new keys by default, so the failure mode flips to
 * "a stray key gets backed up": costs bytes, nothing else.
 *
 * The key names are the ONE brand-specific thing in this brand-free slice — the
 * file cannot be correct without knowing them — so they are a default-valued
 * `rule` parameter, not a hardcoded constant, and a non-mso consumer passes its own.
 *
 * `mso:` / `mso.` are the current namespaces; `sv:` is the pre-rename one and is
 * STILL WRITTEN today (sv:dock, sv:shell, sv:profiles…) — renaming those keys
 * would have reset every existing user's dock and shell choice, so they stayed.
 * `alfa.` is the assistant store (skills / agents / automations).
 *
 * `extra` is for keys that predate any namespace and cannot be reached by a
 * prefix without also matching unrelated site data. Keep it short; a new key
 * should take a prefix instead of landing here.
 */
export type KeyRule = {
  prefixes: readonly string[];
  extra: readonly string[];
  deny: readonly string[];
};

export const MSO_LOCAL_STATE: KeyRule = {
  prefixes: ["mso:", "mso.", "sv:", "alfa."],
  extra: [
    "appshell:layout", // the framework's fallback layout key (used when a manifest omits persistKey)
    "image-editor:autosave:v1",
    "studio.save.v1",
    "reel.draft",
    "reel.settings",
    "reel.layout",
  ],
  deny: [
    // The SECOND AUTH FACTOR (auth/lib/device.ts): password + an approved device
    // id IS the login. Backup files get emailed, synced to Drive, pasted into a
    // chat — carrying an approved id turns "the file leaked" into "the attacker
    // skipped device approval". The id is mirrored into a cookie anyway, so a
    // cache-only wipe already restores it; there is nothing here worth the risk.
    "mso.device.id",
    // Demo-mode's mock filesystem: regenerated from mock-data on demand, worth
    // nothing, and megabytes of it. Backing it up only risks the quota.
    "mso:demo-fs",
  ],
};

/** Bump when the BLOB SHAPE changes. Not the app version — a rebuild must not
 *  invalidate a backup taken by the previous build. */
export const LOCAL_STATE_SCHEMA = 1;

/** Discriminator so importing an unrelated .json fails with "not an MSO backup"
 *  rather than an unhelpful shape error halfway through the restore. */
export const LOCAL_STATE_KIND = "mso.local-state";

export type LocalStateBlob = {
  kind: typeof LOCAL_STATE_KIND;
  schema: number;
  /** App version at export time — informational; restore never gates on it. */
  appVersion: string;
  exportedAt: string;
  keys: Record<string, string>;
};

export type ParseResult =
  | { ok: true; blob: LocalStateBlob; known: string[]; unknown: string[] }
  | { ok: false; error: string };

/** localStorage, or null when it is absent OR ACCESS ITSELF THROWS. Same guard as
 *  assistant/lib/store-persist.ts, for the same reason: with site data blocked
 *  ("Block all cookies", a sandboxed iframe, dom.storage.enabled=false) the
 *  property GETTER throws SecurityError, so a bare `typeof localStorage` throws
 *  before it can return anything. */
function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function ownsKey(key: string, rule: KeyRule = MSO_LOCAL_STATE): boolean {
  if (rule.deny.includes(key)) return false;
  return rule.prefixes.some((p) => key.startsWith(p)) || rule.extra.includes(key);
}

/** Every owned key currently in storage. Snapshotted into an array BEFORE any
 *  write — `Storage.key(i)` indexes a live collection, so removing while
 *  iterating skips entries. */
function ownedKeys(ls: Storage, rule: KeyRule): string[] {
  const out: string[] = [];
  for (let i = 0; i < ls.length; i++) {
    const k = ls.key(i);
    if (k && ownsKey(k, rule)) out.push(k);
  }
  return out;
}

export function collectLocalState(appVersion: string, rule: KeyRule = MSO_LOCAL_STATE): LocalStateBlob {
  const ls = storage();
  const keys: Record<string, string> = {};
  if (ls) {
    for (const k of ownedKeys(ls, rule)) {
      const v = ls.getItem(k);
      if (v !== null) keys[k] = v;
    }
  }
  return {
    kind: LOCAL_STATE_KIND,
    schema: LOCAL_STATE_SCHEMA,
    appVersion,
    exportedAt: new Date().toISOString(),
    keys,
  };
}

/** Validate an uploaded file. Rejects anything this build cannot faithfully
 *  restore — a newer schema is a REJECT, not a best-effort merge, because a
 *  half-understood restore silently corrupts state that has no other copy. */
export function parseLocalState(text: string, rule: KeyRule = MSO_LOCAL_STATE): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "Not valid JSON." };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Not an MSO backup file." };
  const b = raw as Partial<LocalStateBlob>;
  if (b.kind !== LOCAL_STATE_KIND) return { ok: false, error: "Not an MSO backup file." };
  if (b.schema !== LOCAL_STATE_SCHEMA) {
    return {
      ok: false,
      error: `Backup schema ${String(b.schema)}. This build only understands ${LOCAL_STATE_SCHEMA}. Update MSO, then import again.`,
    };
  }
  // Both are rendered verbatim in the confirm dialog; unchecked, a hand-edited file makes it read "MSO [object Object] … Invalid Date".
  if (typeof b.appVersion !== "string" || typeof b.exportedAt !== "string") return { ok: false, error: "Backup is missing its version or timestamp." };
  if (!b.keys || typeof b.keys !== "object" || Array.isArray(b.keys)) return { ok: false, error: "Backup has no keys." };
  const entries = Object.entries(b.keys as Record<string, unknown>);
  if (entries.some(([, v]) => typeof v !== "string")) return { ok: false, error: "Backup holds a non-string value." };
  const known = entries.map(([k]) => k).filter((k) => ownsKey(k, rule));
  const unknown = entries.map(([k]) => k).filter((k) => !ownsKey(k, rule));
  return { ok: true, blob: b as LocalStateBlob, known, unknown };
}

/**
 * REPLACE, not merge: owned keys absent from the blob are deleted first. A merge
 * would leave the Playbook you deleted last week alive next to the restored set,
 * which is not what "restore my backup" means.
 *
 * Keys the rule does not recognise are NOT written — a backup file is arbitrary
 * user-supplied JSON, and writing unbounded keys into storage is a quota bomb —
 * but they ARE returned in `skipped` so the caller can name them. Dropping them
 * in silence is the bug this return type exists to prevent.
 */
export function restoreLocalState(
  blob: LocalStateBlob,
  rule: KeyRule = MSO_LOCAL_STATE,
): { restored: string[]; skipped: string[] } {
  const ls = storage();
  const restored: string[] = [];
  const skipped = Object.keys(blob.keys).filter((k) => !ownsKey(k, rule));
  if (!ls) return { restored, skipped };
  for (const k of ownedKeys(ls, rule)) {
    if (!(k in blob.keys)) ls.removeItem(k);
  }
  for (const [k, v] of Object.entries(blob.keys)) {
    if (!ownsKey(k, rule)) continue;
    try {
      ls.setItem(k, v);
      restored.push(k);
    } catch {
      // Quota: a partial restore beats an aborted one — the caller reports the
      // count, and the keys that did land are still better than nothing.
    }
  }
  return { restored, skipped };
}

/** `mso-backup-2026-08-11.json`. Date-stamped (UTC) because a Downloads folder of
 *  `mso-backup.json`, `mso-backup(1).json`, `mso-backup(2).json` is unrestorable —
 *  you cannot tell which one predates the mistake you are undoing. */
export function localStateFilename(now = new Date()): string {
  return `mso-backup-${now.toISOString().slice(0, 10)}.json`;
}
