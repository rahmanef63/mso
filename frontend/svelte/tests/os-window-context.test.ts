import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeSnapRect,
  createWindowStore,
  hydrateLayout,
  serializeLayout,
  type DesktopBounds,
  type SnapZone,
} from "../src/lib/shell/window-store.ts";
import {
  clampMenuPosition,
  createContextMenuStore,
  type ContextMenuItem,
  type ContextMenuState,
} from "../src/lib/shell/context-menu-store.ts";

const BOUNDS: DesktopBounds = { width: 1440, height: 820, top: 32, bottom: 76 };

test("computeSnapRect calculates non-overlapping halves, quarters, and full bounds respecting insets", () => {
  const full = computeSnapRect("full", BOUNDS);
  assert.equal(full.x, 8);
  assert.equal(full.y, 40);
  assert.equal(full.w, 1424);
  assert.equal(full.h, 696);

  const left = computeSnapRect("left", BOUNDS);
  const right = computeSnapRect("right", BOUNDS);
  assert.equal(left.x, full.x);
  assert.equal(left.y, full.y);
  assert.equal(left.h, full.h);
  assert.equal(right.y, full.y);
  assert.equal(right.h, full.h);
  assert.ok(left.x + left.w < right.x, "left and right halves must not overlap");
  assert.equal(right.x + right.w, full.x + full.w);

  const top = computeSnapRect("top", BOUNDS);
  const bottom = computeSnapRect("bottom", BOUNDS);
  assert.equal(top.w, full.w);
  assert.equal(bottom.w, full.w);
  assert.ok(top.y + top.h < bottom.y, "top and bottom halves must not overlap");
  assert.equal(bottom.y + bottom.h, full.y + full.h);

  const tl = computeSnapRect("tl", BOUNDS);
  const tr = computeSnapRect("tr", BOUNDS);
  const bl = computeSnapRect("bl", BOUNDS);
  const br = computeSnapRect("br", BOUNDS);
  assert.equal(tl.x, left.x);
  assert.equal(tl.w, left.w);
  assert.equal(tl.h, top.h);
  assert.equal(tr.x, right.x);
  assert.equal(tr.w, right.w);
  assert.equal(bl.y, bottom.y);
  assert.equal(br.x, right.x);
  assert.equal(br.y, bottom.y);
  assert.equal(br.x + br.w, full.x + full.w);
  assert.equal(br.y + br.h, full.y + full.h);

  const allZones: SnapZone[] = ["left", "right", "top", "bottom", "tl", "tr", "bl", "br", "full"];
  for (const zone of allZones) {
    const tiny = computeSnapRect(zone, { width: 100, height: 100 });
    assert.ok(tiny.w >= 240 && tiny.h >= 180, `zone ${zone} must enforce min dimensions`);
  }
});

test("snapWindow snaps, saves prevRect, restores minimized windows, and handles full maximize", () => {
  const store = createWindowStore();
  const id = store.openWindow("files", "Files", { w: 600, h: 400 });
  store.moveWindow(id, 120, 100);
  store.minimizeWindow(id);

  store.snapWindow(id, "left", BOUNDS);
  const snappedLeft = store.getState().windows[id];
  const expectedLeft = computeSnapRect("left", BOUNDS);
  assert.equal(snappedLeft.minimized, false);
  assert.equal(snappedLeft.maximized, false);
  assert.equal(store.getState().focused, id);
  assert.deepEqual(
    { x: snappedLeft.x, y: snappedLeft.y, w: snappedLeft.w, h: snappedLeft.h },
    expectedLeft,
  );
  assert.deepEqual(snappedLeft.prevRect, { x: 120, y: 100, w: 600, h: 400 });

  store.snapWindow(id, "full", BOUNDS);
  const snappedFull = store.getState().windows[id];
  const expectedFull = computeSnapRect("full", BOUNDS);
  assert.equal(snappedFull.maximized, true);
  assert.deepEqual(
    { x: snappedFull.x, y: snappedFull.y, w: snappedFull.w, h: snappedFull.h },
    expectedFull,
  );
  assert.deepEqual(snappedFull.prevRect, { x: 120, y: 100, w: 600, h: 400 });

  // Restore via toggleMaximize returns original prevRect
  store.toggleMaximize(id);
  const restored = store.getState().windows[id];
  assert.equal(restored.maximized, false);
  assert.equal(restored.x, 120);
  assert.equal(restored.y, 100);
  assert.equal(restored.w, 600);
  assert.equal(restored.h, 400);

  // Unknown id is a safe no-op
  store.snapWindow("missing", "right", BOUNDS);
  assert.equal(store.getState().order.length, 1);
});

test("togglePin toggles always-on-top state and persists through layout serialization", () => {
  const store = createWindowStore();
  const id = store.openWindow("monitor", "System Monitor");
  assert.equal(store.getState().windows[id].pinned, undefined);

  store.togglePin(id);
  assert.equal(store.getState().windows[id].pinned, true);

  const hydrated = hydrateLayout(serializeLayout(store.getState()));
  assert.equal(hydrated.windows[id].pinned, true);

  store.togglePin(id);
  assert.equal(store.getState().windows[id].pinned, false);

  store.togglePin("non-existent");
  assert.equal(store.getState().windows[id].pinned, false);
});

test("cascadeWindows offsets visible windows, skips minimized ones, and focuses the last cascaded window", () => {
  const store = createWindowStore();
  const w1 = store.openWindow("files", "Files 1", undefined, undefined, { multi: true });
  const w2 = store.openWindow("files", "Files 2", undefined, undefined, { multi: true });
  const w3 = store.openWindow("monitor", "Monitor");
  store.toggleMaximize(w1);
  store.minimizeWindow(w2);

  store.cascadeWindows(BOUNDS);
  const state = store.getState();
  assert.equal(state.windows[w1].maximized, false);
  assert.equal(state.windows[w2].minimized, true);
  assert.equal(state.windows[w3].x - state.windows[w1].x, 32);
  assert.equal(state.windows[w3].y - state.windows[w1].y, 32);
  assert.ok(state.windows[w3].z > state.windows[w1].z);
  assert.equal(state.focused, w3);
});

test("tileWindows arranges 1, 2, 3, and 4 visible windows into non-overlapping grids", () => {
  const store = createWindowStore();
  const a = store.openWindow("files", "A", undefined, undefined, { multi: true });
  store.tileWindows(BOUNDS);
  const full = computeSnapRect("full", BOUNDS);
  assert.equal(store.getState().windows[a].w, full.w);
  assert.equal(store.getState().windows[a].h, full.h);

  const b = store.openWindow("files", "B", undefined, undefined, { multi: true });
  store.tileWindows(BOUNDS);
  const st2 = store.getState();
  assert.ok(st2.windows[a].x + st2.windows[a].w < st2.windows[b].x);
  assert.equal(st2.windows[a].y, st2.windows[b].y);

  const c = store.openWindow("files", "C", undefined, undefined, { multi: true });
  const d = store.openWindow("files", "D", undefined, undefined, { multi: true });
  const hidden = store.openWindow("monitor", "Hidden");
  store.minimizeWindow(hidden);
  store.tileWindows(BOUNDS);

  const st4 = store.getState();
  const rects = [a, b, c, d].map((id) => st4.windows[id]);
  for (let i = 0; i < rects.length; i += 1) {
    assert.equal(rects[i].maximized, false);
    for (let j = i + 1; j < rects.length; j += 1) {
      const r1 = rects[i];
      const r2 = rects[j];
      const overlaps =
        r1.x < r2.x + r2.w &&
        r1.x + r1.w > r2.x &&
        r1.y < r2.y + r2.h &&
        r1.y + r1.h > r2.y;
      assert.equal(overlaps, false, `tiled windows ${r1.id} and ${r2.id} must not overlap`);
    }
  }
  assert.equal(st4.windows[hidden].minimized, true);
});

test("minimizeAll minimizes every window, clears focus, and is idempotent", () => {
  const store = createWindowStore();
  const w1 = store.openWindow("files", "Files");
  const w2 = store.openWindow("monitor", "Monitor");
  let updates = 0;
  const unsub = store.subscribe(() => {
    updates += 1;
  });
  updates = 0;

  store.minimizeAll();
  assert.equal(updates, 1);
  assert.equal(store.getState().windows[w1].minimized, true);
  assert.equal(store.getState().windows[w2].minimized, true);
  assert.equal(store.getState().focused, null);

  store.minimizeAll();
  assert.equal(updates, 1, "second minimizeAll should not emit when already minimized");
  unsub();
});

test("clampMenuPosition keeps menus inside viewport bounds on all four edges", () => {
  assert.deepEqual(clampMenuPosition(120, 90, 220, 180, 1440, 900), { x: 120, y: 90 });
  assert.deepEqual(clampMenuPosition(1400, 860, 220, 180, 1440, 900), { x: 1212, y: 712 });
  assert.deepEqual(clampMenuPosition(-40, -15, 220, 180, 1440, 900), { x: 8, y: 8 });
  assert.deepEqual(clampMenuPosition(200, 200, 260, 240, 200, 200), { x: 8, y: 8 });
  assert.deepEqual(clampMenuPosition(Number.NaN, Number.POSITIVE_INFINITY, 200, 150, 1280, 720), {
    x: 8,
    y: 8,
  });
});

test("createContextMenuStore manages open, close, subscribe, title, and empty-item guard", () => {
  const store = createContextMenuStore();
  const snapshots: ContextMenuState[] = [];
  const unsub = store.subscribe((next) => snapshots.push(next));

  assert.equal(store.getState().open, false);
  assert.equal(snapshots.length, 1);

  const items: ContextMenuItem[] = [
    { id: "max", label: "Maximize", shortcut: "Cmd+M", onSelect: () => {} },
    { type: "sep" },
    { id: "close", label: "Close", danger: true, onSelect: () => {} },
  ];

  store.open(320, 180, items, "Files");
  const opened = store.getState();
  assert.equal(opened.open, true);
  assert.equal(opened.x, 320);
  assert.equal(opened.y, 180);
  assert.equal(opened.title, "Files");
  assert.equal(opened.items.length, 3);
  assert.notEqual(opened.items, items, "store must defensively copy items array");

  store.close();
  assert.equal(store.getState().open, false);
  assert.deepEqual(store.getState().items, []);

  // Closing when already closed is a no-op
  const countBefore = snapshots.length;
  store.close();
  assert.equal(snapshots.length, countBefore);

  // Opening with empty items keeps menu closed
  store.open(50, 50, []);
  assert.equal(store.getState().open, false);

  unsub();
  store.open(100, 100, items);
  assert.equal(snapshots.length, countBefore, "unsubscribed listener must not receive updates");
});
