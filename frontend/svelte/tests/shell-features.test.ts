import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHROME_PROFILES,
  isChromeChoice,
  isChromeProfile,
  resolveChromeProfile,
} from "../src/lib/shell/chrome-profile.ts";
import { filterCommands, type CommandItem } from "../src/lib/shell/command-palette.ts";
import {
  createNotificationStore,
  type NotificationItem,
} from "../src/lib/shell/notifications-store.ts";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("chrome-profile validates choices and resolves explicit and auto profiles", () => {
  assert.equal(CHROME_PROFILES.length, 5);
  assert.deepEqual(
    CHROME_PROFILES.map((p) => p.id),
    ["macos", "windows", "dashboard", "ios", "android"],
  );
  for (const profile of CHROME_PROFILES) {
    assert.equal(profile.description.includes("\u2014"), false);
    assert.equal(isChromeProfile(profile.id), true);
    assert.equal(isChromeChoice(profile.id), true);
    assert.equal(resolveChromeProfile(profile.id, 375, "Android"), profile.id);
    assert.equal(resolveChromeProfile(profile.id, 1440, "iPhone"), profile.id);
  }

  assert.equal(isChromeChoice("auto"), true);
  assert.equal(isChromeProfile("auto"), false);
  for (const invalid of ["", "linux", "desktop", null, undefined, 42, {}]) {
    assert.equal(isChromeChoice(invalid), false);
    assert.equal(isChromeProfile(invalid), false);
  }

  assert.equal(resolveChromeProfile("auto", 1280, "Mozilla/5.0 (X11; Linux x86_64)"), "macos");
  assert.equal(resolveChromeProfile("auto", 641, "Mozilla/5.0 (Linux; Android 14)"), "macos");
  assert.equal(resolveChromeProfile("auto", Number.NaN, "Android"), "macos");

  assert.equal(resolveChromeProfile("auto", 640, "Mozilla/5.0 (Linux; Android 14; Pixel 8)"), "android");
  assert.equal(resolveChromeProfile("auto", 390, "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)"), "ios");
  assert.equal(resolveChromeProfile("auto", 412, "Mozilla/5.0 (iPad; CPU OS 17_0)"), "ios");
  assert.equal(resolveChromeProfile("auto", 360), "ios");
});

test("filterCommands performs case-insensitive substring scoring across label, keywords, and category", () => {
  const noop = () => {};
  const items: CommandItem[] = [
    { id: "cat", label: "Check Status", category: "Terminal", run: noop },
    { id: "kw", label: "Shell Session", category: "Tools", keywords: ["terminal", "bash"], run: noop },
    { id: "sub", label: "Open Remote Terminal", category: "Workspace", run: noop },
    { id: "pre", label: "Terminal App", category: "Workspace", run: noop },
    { id: "exact", label: "Terminal", category: "Apps", run: noop },
    { id: "files", label: "System Monitor", category: "Observability", keywords: ["cpu", "ram"], run: noop },
  ];

  const all = filterCommands(items, "   ");
  assert.deepEqual(all.map((i) => i.id), items.map((i) => i.id));
  assert.notEqual(all, items);

  const ranked = filterCommands(items, "TERMINAL");
  assert.deepEqual(
    ranked.map((i) => i.id),
    ["exact", "pre", "sub", "kw", "cat"],
  );

  const multi = filterCommands(items, "sys obs");
  assert.deepEqual(multi.map((i) => i.id), ["files"]);

  const kwMatch = filterCommands(items, "cpu");
  assert.deepEqual(kwMatch.map((i) => i.id), ["files"]);

  assert.deepEqual(filterCommands(items, "does-not-exist"), []);
});

test("notification store supports push, subscribe, max cap eviction, dismiss, and clear", () => {
  const store = createNotificationStore({ maxItems: 3, defaultTtlMs: 0 });
  const snapshots: Array<readonly NotificationItem[]> = [];
  const unsub = store.subscribe((next) => snapshots.push(next));

  assert.equal(snapshots.length, 1);
  assert.deepEqual(snapshots[0], []);

  const id1 = store.push({ title: "First", detail: "Details 1" });
  const id2 = store.push({ title: "Second", tone: "ok" });
  const id3 = store.push({ title: "Third", tone: "warn" });
  assert.equal(store.getItems().length, 3);
  assert.equal(store.getItems()[0].tone, "info");
  assert.equal(store.getItems()[0].detail, "Details 1");

  const id4 = store.push({ title: "Fourth", tone: "error" });
  assert.deepEqual(store.getItems().map((n) => n.id), [id2, id3, id4]);

  assert.equal(store.dismiss(id1), false);
  assert.equal(store.dismiss(id3), true);
  assert.deepEqual(store.getItems().map((n) => n.id), [id2, id4]);

  unsub();
  const countBefore = snapshots.length;
  store.clear();
  assert.deepEqual(store.getItems(), []);
  assert.equal(snapshots.length, countBefore);
  store.dispose();
});

test("notification store enforces hard cap of 5 items", () => {
  const store = createNotificationStore({ maxItems: 12, defaultTtlMs: 0 });
  const ids: string[] = [];
  for (let i = 1; i <= 7; i += 1) {
    ids.push(store.push({ title: `Item ${i}` }));
  }
  assert.equal(store.getItems().length, 5);
  assert.deepEqual(store.getItems().map((n) => n.id), ids.slice(2));
  store.dispose();
});

test("notification store auto-expires items and cleans timers on eviction and dispose", async () => {
  const store = createNotificationStore({ maxItems: 2, defaultTtlMs: 40 });
  const seenCounts: number[] = [];
  store.subscribe((next) => seenCounts.push(next.length));

  const persistId = store.push({ title: "Persistent", ttlMs: 0 });
  const tempId = store.push({ title: "Ephemeral", ttlMs: 30 });
  assert.deepEqual(store.getItems().map((n) => n.id), [persistId, tempId]);

  await wait(70);
  assert.deepEqual(store.getItems().map((n) => n.id), [persistId]);
  assert.equal(seenCounts[seenCounts.length - 1], 1);

  // Evicted item's timer is cancelled cleanly and does not affect newer items.
  const store2 = createNotificationStore({ maxItems: 1 });
  store2.push({ title: "Soon evicted", ttlMs: 25 });
  const keptId = store2.push({ title: "Kept", ttlMs: 0 });
  await wait(55);
  assert.deepEqual(store2.getItems().map((n) => n.id), [keptId]);
  store2.dispose();

  // Dispose clears pending timers and stops further emissions or mutations.
  const store3 = createNotificationStore();
  let callsAfterDispose = 0;
  let disposed = false;
  store3.subscribe(() => {
    if (disposed) callsAfterDispose += 1;
  });
  store3.push({ title: "Will be disposed", ttlMs: 25 });
  disposed = true;
  store3.dispose();
  assert.deepEqual(store3.getItems(), []);
  assert.equal(store3.push({ title: "Ignored" }), "");
  await wait(55);
  assert.equal(callsAfterDispose, 0);

  store.dispose();
});
