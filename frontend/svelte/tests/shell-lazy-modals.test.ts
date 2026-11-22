import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LAZY_MODAL_KEYS,
  createModalLoaderCache,
  type LazyModalKey,
} from "../src/lib/shell/lazy-modals-meta.ts";

test("LAZY_MODAL_KEYS exposes the exact five shell modals with no duplicates", () => {
  assert.deepEqual(LAZY_MODAL_KEYS, [
    "palette",
    "control",
    "forceQuit",
    "shortcuts",
    "lock",
  ]);
  assert.equal(new Set(LAZY_MODAL_KEYS).size, 5);
});

test("createModalLoaderCache does not invoke loaders until requested", () => {
  const cache = createModalLoaderCache<string>();
  let calls = 0;
  const loader = async () => {
    calls += 1;
    return "loaded";
  };

  for (const key of LAZY_MODAL_KEYS) {
    assert.equal(cache.has(key), false);
    assert.equal(cache.getResolved(key), undefined);
  }
  assert.equal(calls, 0);
  void loader;
});

test("createModalLoaderCache deduplicates concurrent and subsequent loads per key", async () => {
  const cache = createModalLoaderCache<{ name: string }>();
  let calls = 0;
  let release!: (value: { name: string }) => void;

  const loader = () => {
    calls += 1;
    return new Promise<{ name: string }>((resolve) => {
      release = resolve;
    });
  };

  const first = cache.load("palette", loader);
  const second = cache.load("palette", loader);

  assert.equal(calls, 1);
  assert.equal(first, second);
  assert.equal(cache.has("palette"), true);
  assert.equal(cache.getResolved("palette"), undefined);

  const resolvedObj = { name: "CommandPalette" };
  release(resolvedObj);

  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, resolvedObj);
  assert.equal(b, resolvedObj);
  assert.equal(cache.getResolved("palette"), resolvedObj);

  const third = cache.load("palette", () => {
    calls += 1;
    return Promise.resolve({ name: "ShouldNotRun" });
  });
  assert.equal(calls, 1);
  assert.equal(third, first);
  assert.equal(await third, resolvedObj);
});

test("createModalLoaderCache isolates independent keys", async () => {
  const cache = createModalLoaderCache<string>();
  const counts: Record<LazyModalKey, number> = {
    palette: 0,
    control: 0,
    forceQuit: 0,
    shortcuts: 0,
    lock: 0,
  };

  const results = await Promise.all(
    LAZY_MODAL_KEYS.map((key) =>
      cache.load(key, async () => {
        counts[key] += 1;
        return `modal:${key}`;
      }),
    ),
  );

  assert.deepEqual(
    results,
    LAZY_MODAL_KEYS.map((key) => `modal:${key}`),
  );
  for (const key of LAZY_MODAL_KEYS) {
    assert.equal(counts[key], 1);
    assert.equal(cache.has(key), true);
    assert.equal(cache.getResolved(key), `modal:${key}`);
  }

  cache.clear("control");
  assert.equal(cache.has("control"), false);
  assert.equal(cache.getResolved("control"), undefined);
  assert.equal(cache.has("palette"), true);
  assert.equal(cache.getResolved("palette"), "modal:palette");
});

test("createModalLoaderCache clears failed promises on rejection so retry works", async () => {
  const cache = createModalLoaderCache<string>();
  let attempt = 0;

  await assert.rejects(
    () =>
      cache.load("forceQuit", async () => {
        attempt += 1;
        throw new Error("chunk load failed");
      }),
    /chunk load failed/,
  );

  assert.equal(attempt, 1);
  assert.equal(cache.has("forceQuit"), false);
  assert.equal(cache.getResolved("forceQuit"), undefined);

  const recovered = await cache.load("forceQuit", async () => {
    attempt += 1;
    return "ForceQuitModal";
  });

  assert.equal(attempt, 2);
  assert.equal(recovered, "ForceQuitModal");
  assert.equal(cache.has("forceQuit"), true);
  assert.equal(cache.getResolved("forceQuit"), "ForceQuitModal");
});

test("createModalLoaderCache handles synchronous throw and allows retry", async () => {
  const cache = createModalLoaderCache<string>();
  let attempt = 0;

  await assert.rejects(
    () =>
      cache.load("lock", () => {
        attempt += 1;
        throw new Error("sync failure");
      }),
    /sync failure/,
  );

  assert.equal(attempt, 1);
  assert.equal(cache.has("lock"), false);

  const ok = await cache.load("lock", async () => {
    attempt += 1;
    return "LockScreen";
  });
  assert.equal(attempt, 2);
  assert.equal(ok, "LockScreen");
});

test("LazyModals.svelte uses dynamic imports only and contains no em dashes", () => {
  const src = readFileSync(
    new URL("../src/lib/shell/LazyModals.svelte", import.meta.url),
    "utf8",
  );
  assert.equal(src.includes("\u2014"), false, "em dash found in LazyModals.svelte");
  assert.doesNotMatch(
    src,
    /^import\s+(?!type\b).*\.svelte["'];/m,
    "LazyModals.svelte must not statically import modal .svelte components",
  );
  for (const file of [
    "CommandPalette.svelte",
    "ControlCenter.svelte",
    "ForceQuitModal.svelte",
    "ShortcutHelp.svelte",
    "LockScreen.svelte",
  ]) {
    assert.equal(
      src.includes(`import("./${file}")`),
      true,
      `expected dynamic import for ${file}`,
    );
  }
});
