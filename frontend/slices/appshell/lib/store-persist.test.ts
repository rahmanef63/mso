import { beforeEach, describe, expect, it, vi } from "vitest";
import { closeAll, openWindow } from "./store";
import { hydrate, hydrateBoot, serialize } from "./store-persist";
import { shellStore } from "./store-state";
import type { PersistedWindow } from "./types";

// Stub viewport for the clamping test (clampRect is a no-op without window).
vi.stubGlobal("window", Object.assign(globalThis.window ?? {}, { innerWidth: 1280, innerHeight: 800 }));

const pw = (id: string, app: string, extra?: Partial<PersistedWindow>): PersistedWindow => ({
  id,
  app,
  title: app,
  x: 10,
  y: 10,
  w: 400,
  h: 300,
  minimized: false,
  maximized: false,
  ...extra,
});

describe("store persistence", () => {
  beforeEach(() => closeAll());

  it("hydrate REPLACES the window set (profiles/layouts semantics)", () => {
    openWindow("settings", "Settings");
    hydrate([pw("w90", "files"), pw("w91", "monitor")]);
    expect(shellStore.getOrder()).toEqual(["w90", "w91"]);
    expect(shellStore.getFocused()).toBe("w91");
  });

  it("hydrateBoot on an empty store restores everything, focus on last", () => {
    hydrateBoot([pw("w1", "files"), pw("w2", "settings")]);
    expect(shellStore.getOrder()).toEqual(["w1", "w2"]);
    expect(shellStore.getFocused()).toBe("w2");
  });

  it("hydrateBoot keeps a deep-link window: open + focused + payload, layout behind", () => {
    // UrlSync opened /files/home/operator BEFORE the layout hydrated (mount order).
    const live = openWindow("files", "Files", undefined, { path: "/home/operator" }, { multi: true });
    hydrateBoot([pw("w50", "settings"), pw("w51", "monitor")]);

    const order = shellStore.getOrder();
    expect(order).toEqual(["w50", "w51", live]);
    expect(shellStore.getFocused()).toBe(live);
    expect(shellStore.getWindow(live)?.payload).toEqual({ path: "/home/operator" });
    // live window stacks on top of every restored one
    const zs = order.map((id) => shellStore.getWindow(id)!.z);
    expect(Math.max(...zs)).toBe(shellStore.getWindow(live)!.z);
  });

  it("hydrateBoot drops the persisted window of a live SINGLE-instance app", () => {
    const live = openWindow("settings", "Settings", undefined, { tab: "server" });
    hydrateBoot([pw("w50", "settings"), pw("w51", "monitor")]);
    const settings = shellStore.getOrder().filter((id) => shellStore.getWindow(id)?.app === "settings");
    expect(settings).toEqual([live]); // deep link wins, no duplicate singleton
    expect(shellStore.getWindow(live)?.payload).toEqual({ tab: "server" });
    expect(shellStore.getFocused()).toBe(live);
  });

  it("hydrateBoot restores MULTI-app windows alongside the live one, remapping id collisions", () => {
    const live = openWindow("files", "Files", undefined, { path: "/a" }, { multi: true }); // takes w1
    hydrateBoot([pw("w1", "files"), pw("w2", "files")], new Set(["files"]));

    const ids = shellStore.getOrder();
    expect(ids).toHaveLength(3);
    expect(ids[ids.length - 1]).toBe(live); // live on top
    expect(new Set(ids).size).toBe(3); // collided persisted "w1" got a fresh id
    ids.forEach((id) => expect(shellStore.getWindow(id)?.app).toBe("files"));
    expect(shellStore.getFocused()).toBe(live);
  });

  it("hydrateBoot bumps seq past persisted ids so later opens can't collide", () => {
    hydrateBoot([pw("w7", "files")]);
    const next = openWindow("settings", "Settings");
    expect(next).not.toBe("w7");
    expect(Number(next.replace(/\D/g, ""))).toBeGreaterThan(7);
  });

  it("serialize round-trips through hydrateBoot on a clean store", () => {
    hydrateBoot([pw("w3", "files", { minimized: true }), pw("w4", "settings")]);
    const snap = serialize();
    expect(snap.map((w) => w.id)).toEqual(["w3", "w4"]);
    expect(snap[0].minimized).toBe(true);
    expect(snap.some((w) => "z" in w)).toBe(false);
  });

  it("hydrateBoot dedupes a MULTI-app window when persisted + live share the same payload", () => {
    // Live window opened from the URL with payload {path:/home/operator}.
    const live = openWindow("files", "Files", undefined, { path: "/home/operator" }, { multi: true });
    // localStorage has a window for the SAME app + SAME payload — must collapse.
    hydrateBoot(
      [pw("w99", "files", { payload: { path: "/home/operator" } })],
      new Set(["files"]),
    );
    const ids = shellStore.getOrder();
    const files = ids.filter((id) => shellStore.getWindow(id)?.app === "files");
    expect(files).toEqual([live]); // dedupe — one Files window survives
    expect(shellStore.getWindow(live)?.payload).toEqual({ path: "/home/operator" });
  });

  it("hydrateBoot keeps both MULTI-app windows when payloads differ", () => {
    const live = openWindow("files", "Files", undefined, { path: "/a" }, { multi: true });
    hydrateBoot(
      [pw("w99", "files", { payload: { path: "/b" } })],
      new Set(["files"]),
    );
    const files = shellStore.getOrder().filter((id) => shellStore.getWindow(id)?.app === "files");
    expect(files).toHaveLength(2); // different payload → keep both
    // live still on top; persisted one stacked underneath with the /b payload.
    const liveWin = shellStore.getWindow(live)!;
    const otherId = files.find((id) => id !== live)!;
    expect(shellStore.getWindow(otherId)?.payload).toEqual({ path: "/b" });
    expect(liveWin.z).toBeGreaterThan(shellStore.getWindow(otherId)!.z);
  });

  it("hydrateBoot clamps a persisted window whose rect is past the viewport", () => {
    // Saved on a huge monitor → way off-screen on this 1280×800 viewport.
    hydrateBoot([pw("w42", "files", { x: 5000, y: 5000, w: 9999, h: 9999 })]);
    const w = shellStore.getWindow("w42")!;
    // Width clamped to viewport minus gutters; x kept inside the right edge.
    expect(w.w).toBeLessThanOrEqual(1280);
    expect(w.x + w.w).toBeLessThanOrEqual(1280);
    expect(w.y + w.h).toBeLessThanOrEqual(800);
    // Heights/widths must be positive after the clamp.
    expect(w.w).toBeGreaterThan(0);
    expect(w.h).toBeGreaterThan(0);
  });
});
