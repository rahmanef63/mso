import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLIPBOARD_HARD_MAX,
  createClipboardStore,
  filterClipboardItems,
  getSharedClipboardStore,
  type ClipboardItem,
} from "../src/lib/shell/clipboard-store.ts";

test("createClipboardStore adds items in newest-first order and ignores empty or whitespace-only text", () => {
  const store = createClipboardStore();
  assert.deepEqual(store.getItems(), []);

  assert.equal(store.add(""), "");
  assert.equal(store.add("   \n\t  "), "");
  assert.deepEqual(store.getItems(), []);

  const id1 = store.add("first snippet");
  const id2 = store.add("second snippet");
  assert.notEqual(id1, "");
  assert.notEqual(id2, "");
  assert.notEqual(id1, id2);

  const items = store.getItems();
  assert.equal(items.length, 2);
  assert.equal(items[0].id, id2);
  assert.equal(items[0].text, "second snippet");
  assert.equal(items[1].id, id1);
  assert.equal(items[1].text, "first snippet");
  assert.equal(typeof items[0].createdAt, "number");
});

test("createClipboardStore deduplicates consecutive identical entries without suppressing non-consecutive repeats", () => {
  const store = createClipboardStore();
  const snapshots: Array<readonly ClipboardItem[]> = [];
  store.subscribe((next) => snapshots.push(next));

  const id1 = store.add("alpha");
  const countAfterFirst = snapshots.length;
  const dupId = store.add("alpha");

  assert.equal(dupId, id1);
  assert.equal(store.getItems().length, 1);
  assert.equal(snapshots.length, countAfterFirst);

  const id2 = store.add("beta");
  const id3 = store.add("alpha");
  assert.notEqual(id3, id1);
  assert.deepEqual(
    store.getItems().map((item) => ({ id: item.id, text: item.text })),
    [
      { id: id3, text: "alpha" },
      { id: id2, text: "beta" },
      { id: id1, text: "alpha" },
    ],
  );
});

test("createClipboardStore enforces custom maxItems and hard cap of 20 items", () => {
  const customStore = createClipboardStore({ maxItems: 3 });
  const c1 = customStore.add("one");
  const c2 = customStore.add("two");
  const c3 = customStore.add("three");
  const c4 = customStore.add("four");

  assert.equal(customStore.getItems().length, 3);
  assert.deepEqual(
    customStore.getItems().map((item) => item.id),
    [c4, c3, c2],
  );
  assert.equal(customStore.remove(c1), false);

  const hardCapStore = createClipboardStore({ maxItems: 99 });
  const addedIds: string[] = [];
  for (let i = 1; i <= CLIPBOARD_HARD_MAX + 5; i += 1) {
    addedIds.push(hardCapStore.add(`entry-${i}`));
  }

  assert.equal(CLIPBOARD_HARD_MAX, 20);
  assert.equal(hardCapStore.getItems().length, CLIPBOARD_HARD_MAX);
  const expectedNewestFirst = addedIds.slice(-CLIPBOARD_HARD_MAX).reverse();
  assert.deepEqual(
    hardCapStore.getItems().map((item) => item.id),
    expectedNewestFirst,
  );
});

test("createClipboardStore supports remove, clear, and subscribe/unsubscribe lifecycle", () => {
  const store = createClipboardStore({ maxItems: Number.NaN });
  const seenLengths: number[] = [];
  const unsubscribe = store.subscribe((next) => seenLengths.push(next.length));

  assert.deepEqual(seenLengths, [0]);

  const id1 = store.add("cmd --flag");
  const id2 = store.add("systemctl status mso");
  assert.deepEqual(seenLengths, [0, 1, 2]);

  assert.equal(store.remove("non-existent"), false);
  assert.deepEqual(seenLengths, [0, 1, 2]);

  assert.equal(store.remove(id1), true);
  assert.deepEqual(store.getItems().map((i) => i.id), [id2]);
  assert.deepEqual(seenLengths, [0, 1, 2, 1]);

  unsubscribe();
  store.clear();
  assert.deepEqual(store.getItems(), []);
  assert.deepEqual(seenLengths, [0, 1, 2, 1]);

  // Clearing an already-empty store is a no-op
  let extraCalls = 0;
  store.subscribe(() => { extraCalls += 1; });
  assert.equal(extraCalls, 1);
  store.clear();
  assert.equal(extraCalls, 1);
});

test("filterClipboardItems and getSharedClipboardStore work as expected", () => {
  const store = createClipboardStore();
  store.add("bun run check");
  store.add("cargo test --workspace");
  store.add("BUN TEST");

  const all = store.getItems();
  assert.equal(filterClipboardItems(all, "   ").length, 3);
  assert.deepEqual(
    filterClipboardItems(all, "bun").map((i) => i.text),
    ["BUN TEST", "bun run check"],
  );
  assert.deepEqual(filterClipboardItems(all, "missing"), []);

  const sharedA = getSharedClipboardStore();
  const sharedB = getSharedClipboardStore();
  assert.equal(sharedA, sharedB);
});
