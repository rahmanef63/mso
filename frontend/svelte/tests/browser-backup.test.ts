import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACCENT_KEY, BOLD_TEXT_KEY, BROWSER_PREFS_KIND, BROWSER_PREFS_SCHEMA, backupFilename,
  collectBrowserPrefs, describeSkipped, isKnownKey, parseBrowserBackup, restoreBrowserPrefs,
  TEXT_SIZE_KEY, validateStoredValue, type BrowserPrefsBlob, type StorageLike,
} from "../src/lib/settings/browser-backup.ts";
import { SHELL_STORAGE_KEY } from "../src/lib/shell/shell-prefs-store.ts";

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { dump(): Record<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    dump: () => Object.fromEntries(map),
  };
}

const NOW = new Date("2026-11-28T09:00:00.000Z");
const blobOf = (keys: Record<string, string>): BrowserPrefsBlob => ({
  kind: BROWSER_PREFS_KIND, schema: BROWSER_PREFS_SCHEMA, appVersion: "x", exportedAt: NOW.toISOString(), keys,
});

test("allowlist is exact: no prefix wildcard, no key without a reader", () => {
  for (const key of [SHELL_STORAGE_KEY, ACCENT_KEY, BOLD_TEXT_KEY, TEXT_SIZE_KEY]) assert.equal(isKnownKey(key), true);
  // Things v1's prefix rule would have swept up, and must not now.
  for (const key of ["sv:dock", "alfa.agents", "mso:quicklinks", "appshell:layout", "mso.device.id"]) {
    assert.equal(isKnownKey(key), false, key);
  }
});

test("sv:shell is normalized and strictly validated per field", () => {
  assert.deepEqual(
    JSON.parse(validateStoredValue(SHELL_STORAGE_KEY, JSON.stringify({ desktop: "windows", mobile: "android" }))!),
    { desktop: "windows", mobile: "android", override: "auto", iosStyle: "classic" },
  );
  // Unknown members are dropped, not carried through.
  assert.deepEqual(
    JSON.parse(validateStoredValue(SHELL_STORAGE_KEY, JSON.stringify({ desktop: "dashboard", junk: 1 }))!),
    { desktop: "dashboard", mobile: "ios", override: "auto", iosStyle: "classic" },
  );
  assert.equal(validateStoredValue(SHELL_STORAGE_KEY, JSON.stringify({ desktop: "amiga" })), null);
  assert.equal(validateStoredValue(SHELL_STORAGE_KEY, "not json"), null);
  assert.equal(validateStoredValue(SHELL_STORAGE_KEY, JSON.stringify([])), null);
  assert.equal(validateStoredValue(SHELL_STORAGE_KEY, JSON.stringify("macos")), null);
});

test("appearance keys reject out-of-range and malformed values", () => {
  assert.equal(validateStoredValue(ACCENT_KEY, "#0A84FF"), "#0a84ff");
  assert.equal(validateStoredValue(ACCENT_KEY, "#0a84f"), null);
  assert.equal(validateStoredValue(ACCENT_KEY, "red"), null);
  assert.equal(validateStoredValue(ACCENT_KEY, "#0a84ff; background:url(x)"), null);
  assert.equal(validateStoredValue(BOLD_TEXT_KEY, "true"), "true");
  assert.equal(validateStoredValue(BOLD_TEXT_KEY, "false"), "false");
  assert.equal(validateStoredValue(BOLD_TEXT_KEY, "1"), null);
  assert.equal(validateStoredValue(TEXT_SIZE_KEY, "0"), "0");
  assert.equal(validateStoredValue(TEXT_SIZE_KEY, "100"), "100");
  assert.equal(validateStoredValue(TEXT_SIZE_KEY, "101"), null);
  assert.equal(validateStoredValue(TEXT_SIZE_KEY, "-5"), null);
  assert.equal(validateStoredValue(TEXT_SIZE_KEY, "4.6"), null);
});

test("non-string values never pass, so a JSON number cannot become a preference", () => {
  assert.equal(validateStoredValue(TEXT_SIZE_KEY, 46 as unknown), null);
  assert.equal(validateStoredValue(BOLD_TEXT_KEY, true as unknown), null);
  assert.equal(validateStoredValue(SHELL_STORAGE_KEY, { desktop: "macos" } as unknown), null);
});

test("export collects only allowlisted keys and reports corrupt stored rows", () => {
  const { blob, excluded } = collectBrowserPrefs(memoryStorage({
    [SHELL_STORAGE_KEY]: JSON.stringify({ desktop: "macos" }),
    [ACCENT_KEY]: "#ff0000",
    [BOLD_TEXT_KEY]: "true",
    [TEXT_SIZE_KEY]: "999",
    "sv:dock": "[]",
    "mso.device.id": "a".repeat(32),
  }), "sha-abc", NOW);
  assert.equal(blob.kind, BROWSER_PREFS_KIND);
  assert.equal(blob.schema, BROWSER_PREFS_SCHEMA);
  assert.deepEqual(Object.keys(blob.keys).sort(), [ACCENT_KEY, BOLD_TEXT_KEY, SHELL_STORAGE_KEY].sort());
  assert.deepEqual(excluded, [TEXT_SIZE_KEY]);
  assert.equal(blob.exportedAt, NOW.toISOString());
  assert.equal(backupFilename(NOW), "mso-browser-prefs-2026-11-28.json");
});

test("a legacy v1 envelope restores the fields both builds share", () => {
  const res = parseBrowserBackup(JSON.stringify({
    kind: "mso.local-state",
    schema: 1,
    appVersion: "0.2.15",
    exportedAt: "2026-08-11T00:00:00.000Z",
    keys: {
      [SHELL_STORAGE_KEY]: JSON.stringify({ desktop: "windows", mobile: "android" }),
      [ACCENT_KEY]: "#00ff00",
      [BOLD_TEXT_KEY]: "false",
      [TEXT_SIZE_KEY]: "70",
      "sv:dock": "[]",
      "appshell:layout": "{}",
      "mso.device.id": "f".repeat(32),
    },
  }));
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.deepEqual(res.accepted.sort(), [ACCENT_KEY, BOLD_TEXT_KEY, SHELL_STORAGE_KEY, TEXT_SIZE_KEY].sort());
  const reasons = Object.fromEntries(res.skipped.map((s) => [s.key, s.reason]));
  assert.equal(reasons["mso.device.id"], "security");
  assert.equal(reasons["sv:dock"], "unknown");
  assert.equal(reasons["appshell:layout"], "unknown");
  // Security keys are counted, never written.
  assert.deepEqual(describeSkipped(res.skipped), { total: 3, security: 1, unknown: 2, invalid: 0 });
});

test("invalid values inside a valid envelope are skipped, not rejected wholesale", () => {
  const res = parseBrowserBackup(JSON.stringify({
    ...blobOf({ [SHELL_STORAGE_KEY]: JSON.stringify({ desktop: "amiga" }), [TEXT_SIZE_KEY]: "40" }),
  }));
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.deepEqual(res.accepted, [TEXT_SIZE_KEY]);
  assert.deepEqual(res.skipped, [{ key: SHELL_STORAGE_KEY, reason: "invalid" }]);
});

test("unsupported schema, wrong kind, malformed and oversized inputs are refused", () => {
  const worse = parseBrowserBackup(JSON.stringify({ ...blobOf({}), schema: BROWSER_PREFS_SCHEMA + 1 }));
  assert.equal(worse.ok, false);
  if (!worse.ok) assert.match(worse.error, /Update MSO/);
  assert.equal(parseBrowserBackup(JSON.stringify({ ...blobOf({}), kind: "some.other.app" })).ok, false);
  assert.equal(parseBrowserBackup("{not json").ok, false);
  assert.equal(parseBrowserBackup("").ok, false);
  assert.equal(parseBrowserBackup("[]").ok, false);
  assert.equal(parseBrowserBackup("x".repeat(70 * 1024)).ok, false);
});

test("restore writes every key or rolls the written ones back on a quota failure", () => {
  const storage = memoryStorage({ [ACCENT_KEY]: "#111111", [TEXT_SIZE_KEY]: "10" });
  assert.deepEqual(
    restoreBrowserPrefs(blobOf({ [ACCENT_KEY]: "#222222", [TEXT_SIZE_KEY]: "20" }), storage),
    { ok: true, restored: [ACCENT_KEY, TEXT_SIZE_KEY] },
  );
  assert.equal(storage.dump()[ACCENT_KEY], "#222222");

  // Fail on the second write: the first must not survive.
  let writes = 0;
  const res = restoreBrowserPrefs(blobOf({ [ACCENT_KEY]: "#333333", [TEXT_SIZE_KEY]: "30" }), {
    getItem: (k) => (k === ACCENT_KEY ? "#111111" : k === TEXT_SIZE_KEY ? "10" : null),
    setItem: () => {
      writes += 1;
      if (writes === 2) throw new Error("QuotaExceededError");
    },
    removeItem: () => {},
  });
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.rolledBack, true);
  assert.match(res.error, /current preferences were kept/);

  // Unknown keys in the blob are never written, even if a caller smuggled one in.
  const guarded = memoryStorage();
  assert.deepEqual(
    restoreBrowserPrefs(blobOf({ "mso.device.id": "a".repeat(32), [ACCENT_KEY]: "#444444" }), guarded),
    { ok: true, restored: [ACCENT_KEY] },
  );
  assert.equal(guarded.dump()["mso.device.id"], undefined);
});

test("restore refuses without storage or with nothing restorable, and never deletes absent keys", () => {
  assert.equal(restoreBrowserPrefs(blobOf({ [ACCENT_KEY]: "#000000" }), null).ok, false);
  assert.equal(restoreBrowserPrefs(blobOf({}), memoryStorage()).ok, false);
  const storage = memoryStorage({ [ACCENT_KEY]: "#111111", [TEXT_SIZE_KEY]: "10" });
  restoreBrowserPrefs(blobOf({ [ACCENT_KEY]: "#222222" }), storage);
  assert.equal(storage.dump()[TEXT_SIZE_KEY], "10");
});
