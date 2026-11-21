import { test } from "node:test";
import assert from "node:assert/strict";
import { createWindowStore, hydrateLayout, serializeLayout, stateToUrl, urlToApp, type AppSlugMap, type ShellLayoutState } from "../src/lib/shell/window-store.ts";

const SLUGS: AppSlugMap = { monitor: "monitor", files: "files", devices: "devices" };

test("singleton open reuses window, updates payload, restores minimized, and emits immutable snapshots", () => {
  const store = createWindowStore();
  const seen: ShellLayoutState[] = [];
  const unsub = store.subscribe((next) => seen.push(next));
  const id1 = store.openWindow("monitor", "System Monitor", { w: 600, h: 400 }, { tab: "cpu" });
  const snap1 = store.getState();
  store.minimizeWindow(id1);
  assert.equal(store.getState().windows[id1].minimized, true);
  assert.equal(store.getState().focused, null);

  const id2 = store.openWindow("monitor", "System Monitor", undefined, { tab: "disk" });
  assert.equal(id2, id1);
  assert.equal(store.getState().windows[id1].minimized, false);
  assert.deepEqual(store.getState().windows[id1].payload, { tab: "disk" });
  assert.equal(store.getState().focused, id1);
  assert.notEqual(snap1, store.getState());
  assert.deepEqual(snap1.windows[id1].payload, { tab: "cpu" });
  unsub();
  const count = seen.length;
  store.moveWindow(id1, 10, 20);
  assert.equal(seen.length, count);
});

test("multi-instance open spawns separate windows and focusApp picks highest-z window", () => {
  const store = createWindowStore();
  const a = store.openWindow("files", "Files A", undefined, "/srv/a", { multi: true });
  const b = store.openWindow("files", "Files B", undefined, "/srv/b", { multi: true });
  assert.notEqual(a, b);
  assert.equal(store.getState().order.length, 2);
  assert.equal(store.getState().focused, b);

  store.focusWindow(a);
  store.minimizeWindow(a);
  assert.equal(store.getState().focused, b);
  assert.equal(store.focusApp("files", "/srv/updated"), true);
  assert.equal(store.getState().focused, a);
  assert.equal(store.getState().windows[a].minimized, false);
  assert.equal(store.getState().windows[a].payload, "/srv/updated");
  assert.equal(store.focusApp("unknown"), false);
});

test("closeWindow honors close guard veto and falls back focus to highest-z visible window", () => {
  const store = createWindowStore();
  const w1 = store.openWindow("monitor", "Monitor");
  const w2 = store.openWindow("files", "Files", undefined, undefined, { multi: true });
  const w3 = store.openWindow("devices", "Devices");
  store.minimizeWindow(w2);
  store.focusWindow(w3);

  let allowClose = false;
  store.setCloseGuard(w3, () => allowClose);
  assert.equal(store.closeWindow(w3), false);
  assert.ok(store.getState().windows[w3]);

  allowClose = true;
  assert.equal(store.closeWindow(w3), true);
  assert.equal(store.getState().windows[w3], undefined);
  assert.equal(store.getState().focused, w1);
  assert.equal(store.closeWindow(w1), true);
  assert.equal(store.getState().focused, null);
});

test("toggleMaximize saves and restores prevRect; move and resize enforce bounds", () => {
  const store = createWindowStore();
  const id = store.openWindow("files", "Files", { w: 500, h: 320 });
  store.moveWindow(id, 120, 90);
  store.resizeWindow(id, 100, 50);
  assert.equal(store.getState().windows[id].w, 240);
  assert.equal(store.getState().windows[id].h, 180);

  store.toggleMaximize(id);
  assert.equal(store.getState().windows[id].maximized, true);
  assert.deepEqual(store.getState().windows[id].prevRect, { x: 120, y: 90, w: 240, h: 180 });
  store.toggleMaximize(id);
  assert.equal(store.getState().windows[id].maximized, false);
  assert.equal(store.getState().windows[id].x, 120);
  store.moveWindow(id, Number.NaN, 10);
  assert.equal(store.getState().windows[id].x, 120);
  store.restoreWindow(id);
  assert.equal(store.getState().focused, id);
});

test("stateToUrl and urlToApp roundtrip paths and ignore reserved prefixes", () => {
  const store = createWindowStore();
  assert.equal(stateToUrl(store.getState(), SLUGS), "/");

  const mon = store.openWindow("monitor", "Monitor");
  assert.equal(stateToUrl(store.getState(), SLUGS), "/monitor");
  store.minimizeWindow(mon);
  assert.equal(stateToUrl(store.getState(), SLUGS), "/");

  store.openWindow("files", "Files", undefined, "/srv/my docs/readme.md");
  const url = stateToUrl(store.getState(), SLUGS);
  assert.equal(url, "/files/srv/my%20docs/readme.md");
  assert.deepEqual(urlToApp(url, SLUGS), { app: "files", path: "/srv/my docs/readme.md" });
  assert.deepEqual(urlToApp("/monitor", SLUGS), { app: "monitor" });
  assert.deepEqual(urlToApp("/files/~/notes/todo.md?x=1", SLUGS), { app: "files", path: "~/notes/todo.md" });

  for (const reserved of ["/api", "/api/v1/fs/list", "/_next/static", "/mcp", "/oauth/callback", "/.well-known/openid", "/a2a/task"]) {
    assert.equal(urlToApp(reserved, SLUGS), null);
  }
  assert.equal(urlToApp("/unknown-app", SLUGS), null);
  assert.equal(urlToApp("/files/%E0%A4%A", SLUGS), null);
});

test("serializeLayout and hydrateLayout roundtrip and fail safe on corrupt or hostile input", () => {
  const store = createWindowStore();
  const w1 = store.openWindow("files", "Files", { w: 640, h: 420 }, "/srv/work");
  store.openWindow("monitor", "Monitor");
  store.focusWindow(w1);

  const restored = hydrateLayout(serializeLayout(store.getState()));
  assert.deepEqual(restored.order, store.getState().order);
  assert.equal(restored.focused, w1);
  assert.equal(restored.windows[w1].payload, "/srv/work");

  const nextStore = createWindowStore(restored);
  const w3 = nextStore.openWindow("devices", "Devices");
  assert.equal(nextStore.getState().order.length, 3);
  assert.ok(!restored.windows[w3]);

  for (const bad of ["", "{bad", "[]", JSON.stringify({ version: 2, windows: [] }), JSON.stringify({ version: 1, windows: null })]) {
    assert.deepEqual(hydrateLayout(bad), { windows: {}, order: [], focused: null });
  }
  const polluted = hydrateLayout(JSON.stringify({
    version: 1, focused: "__proto__",
    windows: [
      { id: "__proto__", app: "files", title: "Bad", x: 0, y: 0, w: 300, h: 200, z: 1, minimized: false, maximized: false },
      { id: "w1", app: "files", title: "BadRect", x: 0, y: 0, w: -5, h: 200, z: 1, minimized: false, maximized: false },
    ],
  }));
  assert.deepEqual(polluted, { windows: {}, order: [], focused: null });
});
