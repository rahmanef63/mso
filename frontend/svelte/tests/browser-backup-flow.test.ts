import { test } from "node:test";
import assert from "node:assert/strict";
import { createBrowserBackupFlow } from "../src/lib/settings/browser-backup-flow.ts";
import {
  ACCENT_KEY, BOLD_TEXT_KEY, BROWSER_PREFS_KIND, BROWSER_PREFS_SCHEMA, TEXT_SIZE_KEY,
} from "../src/lib/settings/browser-backup.ts";
import { SHELL_STORAGE_KEY } from "../src/lib/shell/shell-prefs-store.ts";

const NOW = new Date("2026-11-28T09:00:00.000Z");

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

function backupJson(keys: Record<string, string>, overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    kind: BROWSER_PREFS_KIND, schema: BROWSER_PREFS_SCHEMA, appVersion: "sha-abc",
    exportedAt: NOW.toISOString(), keys, ...overrides,
  });
}

function makeFlow(initial: Record<string, string> = {}) {
  const storage = memoryStorage(initial);
  let reloads = 0;
  const flow = createBrowserBackupFlow({
    storage: () => storage,
    reload: () => { reloads += 1; },
    appVersion: "sha-abc",
    now: () => NOW,
  });
  return { flow, storage, reloads: () => reloads };
}

test("import stages a file and writes nothing until it is confirmed", () => {
  const { flow, storage, reloads } = makeFlow({ [ACCENT_KEY]: "#111111" });
  assert.equal(flow.openFile("b.json", backupJson({ [ACCENT_KEY]: "#222222" })).ok, true);
  assert.equal(flow.snapshot().pending?.file, "b.json");
  // Staged only: the current value still stands and nothing has reloaded.
  assert.equal(storage.map.get(ACCENT_KEY), "#111111");
  assert.equal(reloads(), 0);
});

test("cancel discards the staged import and keeps current preferences", () => {
  const { flow, storage, reloads } = makeFlow({ [ACCENT_KEY]: "#111111" });
  flow.openFile("b.json", backupJson({ [ACCENT_KEY]: "#222222" }));
  flow.cancel();
  assert.equal(flow.snapshot().pending, null);
  assert.equal(storage.map.get(ACCENT_KEY), "#111111");
  assert.equal(reloads(), 0);
  // Confirming after a cancel does nothing at all.
  assert.equal(flow.confirm().ok, false);
  assert.equal(storage.map.get(ACCENT_KEY), "#111111");
  assert.equal(reloads(), 0);
});

test("confirm writes the staged values and reloads once", () => {
  const { flow, storage, reloads } = makeFlow({ [ACCENT_KEY]: "#111111" });
  flow.openFile("b.json", backupJson({
    [ACCENT_KEY]: "#222222", [BOLD_TEXT_KEY]: "true", [TEXT_SIZE_KEY]: "70",
    [SHELL_STORAGE_KEY]: JSON.stringify({ desktop: "windows" }),
  }));
  const res = flow.confirm();
  assert.equal(res.ok, true);
  assert.equal(storage.map.get(ACCENT_KEY), "#222222");
  assert.equal(storage.map.get(BOLD_TEXT_KEY), "true");
  assert.equal(storage.map.get(TEXT_SIZE_KEY), "70");
  assert.deepEqual(JSON.parse(storage.map.get(SHELL_STORAGE_KEY)!), {
    desktop: "windows", mobile: "ios", override: "auto", iosStyle: "classic",
  });
  assert.equal(reloads(), 1);
  assert.equal(flow.snapshot().pending, null);
  assert.match(flow.snapshot().notice ?? "", /Restored 4 preferences/);
});

test("a refused file never reaches the confirm step", () => {
  const { flow, reloads } = makeFlow({ [ACCENT_KEY]: "#111111" });
  assert.equal(flow.openFile("x.json", "{not json").ok, false);
  assert.equal(flow.snapshot().pending, null);
  assert.match(flow.snapshot().error ?? "", /Not valid JSON/);
  // A file with only keys this build cannot use is refused, not silently empty.
  assert.equal(flow.openFile("y.json", backupJson({ "sv:dock": "[]" })).ok, false);
  assert.match(flow.snapshot().error ?? "", /Nothing in that file/);
  assert.equal(reloads(), 0);
});

test("no reload when the write fails, and the previous values survive", () => {
  const storage = memoryStorage({ [ACCENT_KEY]: "#111111" });
  let reloads = 0;
  let writes = 0;
  const flow = createBrowserBackupFlow({
    storage: () => ({
      ...storage,
      setItem: () => { writes += 1; throw new Error("QuotaExceededError"); },
    }),
    reload: () => { reloads += 1; },
    appVersion: "sha-abc",
  });
  flow.openFile("b.json", backupJson({ [ACCENT_KEY]: "#222222" }));
  const res = flow.confirm();
  assert.equal(res.ok, false);
  assert.equal(reloads, 0);
  assert.equal(storage.map.get(ACCENT_KEY), "#111111");
  assert.equal(flow.snapshot().pending, null);
  assert.match(flow.snapshot().error ?? "", /current preferences were kept/);
  assert.ok(writes > 0);
});

test("export reports the allowlisted count and refuses an empty browser", () => {
  const { flow } = makeFlow({ [ACCENT_KEY]: "#AABBCC", "mso.device.id": "a".repeat(32) });
  const res = flow.exportBackup();
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.count, 1);
  assert.equal(res.filename, "mso-browser-prefs-2026-11-28.json");
  const parsed = JSON.parse(res.json);
  assert.deepEqual(Object.keys(parsed.keys), [ACCENT_KEY]);
  assert.equal(parsed.keys[ACCENT_KEY], "#aabbcc");

  const empty = makeFlow().flow.exportBackup();
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.match(empty.error, /none of the preferences/);
});
