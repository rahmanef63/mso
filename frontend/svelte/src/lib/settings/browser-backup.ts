// Export / import for the browser preferences MSO v2 actually reads back.
//
// v1 exported a prefix rule (`mso:`, `mso.`, `sv:`, `alfa.`), suiting a shell that
// kept a dozen stores in browser storage. v2 keeps four keys; the prefix rule would
// export keys nothing reads and would import `mso.device.id`, the second auth
// factor. So: explicit allowlist, every key validated in both directions.

import { normalizeShellPrefs, SHELL_STORAGE_KEY, type StorageLike as ShellStorage } from "../shell/shell-prefs-store.ts";

export const BROWSER_PREFS_KIND = "mso.browser-prefs";
export const BROWSER_PREFS_SCHEMA = 1;
/** The v1 envelope, still accepted for the fields both builds share. */
export const LEGACY_STATE_KIND = "mso.local-state";
const LEGACY_STATE_SCHEMA = 1;

export const ACCENT_KEY = "mso.shell.accent";
export const BOLD_TEXT_KEY = "mso.shell.boldText";
export const TEXT_SIZE_KEY = "mso.shell.textSize";

/** Every value is a short string; anything larger is not a file this build wrote,
 *  and parsing it is the cheapest way to fill the heap. */
export const MAX_BACKUP_BYTES = 64 * 1024;
/** Never travels in a backup. Named so the dialog can say "left out on purpose". */
export const DENIED_KEYS: readonly string[] = ["mso.device.id", "mso:demo-fs"];
export const KNOWN_KEYS: readonly string[] = [SHELL_STORAGE_KEY, ACCENT_KEY, BOLD_TEXT_KEY, TEXT_SIZE_KEY];

/** The shell store's storage type, plus removal that rollback needs. Borrowing it
 *  keeps one storage contract between the reader and the backup. */
export type StorageLike = ShellStorage & { removeItem?(key: string): void };
export type BrowserPrefsBlob = {
  kind: typeof BROWSER_PREFS_KIND; schema: number; appVersion: string; exportedAt: string; keys: Record<string, string>;
};

export type SkippedKey = { key: string; reason: "unknown" | "invalid" | "security" };
export type ParseResult =
  | { ok: true; blob: BrowserPrefsBlob; accepted: string[]; skipped: SkippedKey[] }
  | { ok: false; error: string };
export type RestoreResult = { ok: true; restored: string[] } | { ok: false; error: string; rolledBack: boolean };

/** True only for keys this build reads back. No prefix matching. */
export function isKnownKey(key: string): boolean {
  return KNOWN_KEYS.includes(key);
}

const HEX = /^#[0-9a-f]{6}$/i;

/** The value to store, or null when the v2 readers would not accept the input.
 *  Normalizing here (not in the component) means an import can never leave a
 *  half-valid row behind. */
export function validateStoredValue(key: string, raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (key === SHELL_STORAGE_KEY) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const rec = parsed as Record<string, unknown>;
    const normalized = normalizeShellPrefs(rec);
    // A row whose every known field was unusable normalizes to the defaults;
    // writing that would read back as "this build ignored your backup".
    const anyValid =
      normalized.desktop === rec.desktop ||
      normalized.mobile === rec.mobile ||
      normalized.override === rec.override ||
      normalized.iosStyle === rec.iosStyle;
    return anyValid ? JSON.stringify(normalized) : null;
  }
  if (key === ACCENT_KEY) return HEX.test(raw) ? raw.toLowerCase() : null;
  if (key === BOLD_TEXT_KEY) return raw === "true" || raw === "false" ? raw : null;
  if (key === TEXT_SIZE_KEY) {
    if (!/^\d{1,3}$/.test(raw)) return null;
    const n = Number(raw);
    return n >= 0 && n <= 100 ? String(n) : null;
  }
  return null;
}

/** Allowlisted keys currently in storage, already validated. A corrupt stored
 *  value is left out rather than exported as-is. */
export function collectBrowserPrefs(
  storage: StorageLike | null,
  appVersion: string,
  now: Date = new Date(),
): { blob: BrowserPrefsBlob; excluded: string[] } {
  const keys: Record<string, string> = {};
  const excluded: string[] = [];
  for (const key of storage ? KNOWN_KEYS : []) {
    let raw: string | null = null;
    try { raw = storage!.getItem(key); } catch { continue; }
    if (raw === null) continue;
    const valid = validateStoredValue(key, raw);
    if (valid === null) excluded.push(key);
    else keys[key] = valid;
  }
  return {
    blob: { kind: BROWSER_PREFS_KIND, schema: BROWSER_PREFS_SCHEMA, appVersion, exportedAt: now.toISOString(), keys },
    excluded,
  };
}

export const backupFilename = (now: Date = new Date()): string =>
  `mso-browser-prefs-${now.toISOString().slice(0, 10)}.json`;

/** Accepts this build's envelope and the v1 one. Anything else is refused whole
 *  rather than partially applied: a backup you only half-understand must not be
 *  written over state that has no other copy. */
export function parseBrowserBackup(text: string): ParseResult {
  if (typeof text !== "string" || text.length === 0) return { ok: false, error: "The file is empty." };
  if (text.length > MAX_BACKUP_BYTES) return { ok: false, error: "That file is too large to be an MSO browser backup." };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "Not valid JSON." };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Not an MSO browser backup." };

  const b = raw as Record<string, unknown>;
  const legacy = b.kind === LEGACY_STATE_KIND;
  if (!legacy && b.kind !== BROWSER_PREFS_KIND) return { ok: false, error: "Not an MSO browser backup." };
  const expected = legacy ? LEGACY_STATE_SCHEMA : BROWSER_PREFS_SCHEMA;
  if (b.schema !== expected) {
    return {
      ok: false,
      error: `Backup schema ${String(b.schema)}. This build understands ${expected}. Update MSO, then import again.`,
    };
  }
  if (typeof b.appVersion !== "string" || typeof b.exportedAt !== "string") {
    return { ok: false, error: "Backup is missing its version or timestamp." };
  }
  if (!b.keys || typeof b.keys !== "object" || Array.isArray(b.keys)) {
    return { ok: false, error: "Backup holds no preference keys." };
  }

  const entries = Object.entries(b.keys as Record<string, unknown>);
  // The map is Record<string, string>; anything else is a hand-edited or foreign
  // file, not a preference this build could have written.
  if (entries.some(([, value]) => typeof value !== "string")) return { ok: false, error: "Backup holds a value that is not text." };

  const accepted: string[] = [];
  const skipped: SkippedKey[] = [];
  const keys: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (DENIED_KEYS.includes(key)) skipped.push({ key, reason: "security" });
    else if (!isKnownKey(key)) skipped.push({ key, reason: "unknown" });
    else {
      const valid = validateStoredValue(key, value);
      if (valid === null) skipped.push({ key, reason: "invalid" });
      else { keys[key] = valid; accepted.push(key); }
    }
  }
  return {
    ok: true,
    blob: { kind: BROWSER_PREFS_KIND, schema: BROWSER_PREFS_SCHEMA, appVersion: b.appVersion, exportedAt: b.exportedAt, keys },
    accepted,
    skipped,
  };
}

/**
 * Writes every key in the blob, or none of them. Previous values are captured
 * before the first write, so a quota failure halfway through puts storage back
 * exactly as it was; anything else leaves two half-applied appearance sets with
 * no way to tell which is which. Keys absent from the blob are never deleted.
 */
export function restoreBrowserPrefs(blob: BrowserPrefsBlob, storage: StorageLike | null): RestoreResult {
  if (!storage) return { ok: false, error: "This browser does not allow local storage.", rolledBack: false };
  const entries = Object.entries(blob.keys).filter(([key]) => isKnownKey(key));
  if (entries.length === 0) return { ok: false, error: "Nothing in this file can be restored by this build.", rolledBack: false };

  const previous = new Map<string, string | null>();
  for (const [key] of entries) {
    try { previous.set(key, storage.getItem(key)); } catch { previous.set(key, null); }
  }

  const restored: string[] = [];
  for (const [key, value] of entries) {
    try {
      storage.setItem(key, value);
      restored.push(key);
    } catch {
      let rolledBack = true;
      for (const written of restored) {
        const prev = previous.get(written) ?? null;
        try {
          if (prev === null) {
            if (!storage.removeItem) throw new Error("no removeItem");
            storage.removeItem(written);
          } else storage.setItem(written, prev);
        } catch {
          rolledBack = false;
        }
      }
      return {
        ok: false,
        error: "This browser refused the write (storage is full or blocked). Your current preferences were kept.",
        rolledBack,
      };
    }
  }
  return { ok: true, restored };
}

/** Counts only: the card never prints stored values, so a screenshot of Settings
 *  leaks nothing. */
export function describeSkipped(
  skipped: readonly SkippedKey[],
): { total: number; security: number; unknown: number; invalid: number } {
  return {
    total: skipped.length,
    security: skipped.filter((s) => s.reason === "security").length,
    unknown: skipped.filter((s) => s.reason === "unknown").length,
    invalid: skipped.filter((s) => s.reason === "invalid").length,
  };
}
