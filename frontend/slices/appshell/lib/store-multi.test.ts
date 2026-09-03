import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeAll,
  closeWindow,
  focusApp,
  focusWindow,
  openWindow,
} from "./store";
import { shellStore } from "./store-state";

// store.ts reads window.innerWidth via spawnRect — stub a viewport like the
// store-geometry test does so spawnRect doesn't NaN.
vi.stubGlobal("window", Object.assign(globalThis.window ?? {}, {
  innerWidth: 1280,
  innerHeight: 800,
}));

describe("openWindow — single-instance vs multi", () => {
  beforeEach(() => closeAll());

  it("reuses the same window when a single-instance app is opened twice", () => {
    const a = openWindow("settings", "Settings");
    const b = openWindow("settings", "Settings"); // singleton: same id back
    expect(a).toBe(b);
    expect(shellStore.getOrder()).toHaveLength(1);
    expect(shellStore.getFocused()).toBe(a);
  });

  it("updates payload + refocuses when a single-instance app is reopened", () => {
    const a = openWindow("settings", "Settings", undefined, { tab: "general" });
    // Take focus off so we can prove the reopen refocuses it.
    const other = openWindow("monitor", "Monitor");
    expect(shellStore.getFocused()).toBe(other);
    const a2 = openWindow("settings", "Settings", undefined, { tab: "server" });
    expect(a2).toBe(a);
    expect(shellStore.getWindow(a)?.payload).toEqual({ tab: "server" });
    expect(shellStore.getFocused()).toBe(a);
  });

  it("spawns a fresh window each call for a `multi` app", () => {
    const a = openWindow("files", "Files", undefined, { path: "/a" }, { multi: true });
    const b = openWindow("files", "Files", undefined, { path: "/b" }, { multi: true });
    expect(a).not.toBe(b);
    expect(shellStore.getOrder()).toEqual([a, b]);
    expect(shellStore.getWindow(a)?.payload).toEqual({ path: "/a" });
    expect(shellStore.getWindow(b)?.payload).toEqual({ path: "/b" });
  });
});

describe("focusApp", () => {
  beforeEach(() => closeAll());

  it("is a no-op (returns false) when no window for the app exists", () => {
    const ok = focusApp("ghost");
    expect(ok).toBe(false);
    expect(shellStore.getOrder()).toHaveLength(0);
    expect(shellStore.getFocused()).toBeNull();
  });

  it("updates the reused window payload when a deep-link focuses it", () => {
    const assistant = openWindow("assistant", "Alfa", undefined, { path: "/chat" });
    openWindow("monitor", "Monitor");
    expect(focusApp("assistant", { path: "/mcp" })).toBe(true);
    expect(shellStore.getFocused()).toBe(assistant);
    expect(shellStore.getWindow(assistant)?.payload).toEqual({ path: "/mcp" });
  });

  it("brings the front-most window of an existing app to focus (highest z wins)", () => {
    // Two `files` windows + one `monitor` between them, all spawned via openWindow.
    const f1 = openWindow("files", "Files", undefined, { path: "/a" }, { multi: true });
    const m = openWindow("monitor", "Monitor");
    const f2 = openWindow("files", "Files", undefined, { path: "/b" }, { multi: true });

    // Click `monitor` so it's currently focused — focusApp("files") must raise
    // the front-most files window (f2 has higher z than f1).
    focusWindow(m);
    expect(shellStore.getFocused()).toBe(m);

    const ok = focusApp("files");
    expect(ok).toBe(true);
    expect(shellStore.getFocused()).toBe(f2);
    // f2's z is now strictly above every other window.
    const fz = shellStore.getWindow(f2)!.z;
    const others = [f1, m].map((id) => shellStore.getWindow(id)!.z);
    others.forEach((z) => expect(fz).toBeGreaterThan(z));
  });
});

describe("closeWindow focus transfer", () => {
  beforeEach(() => closeAll());

  it("transfers focus to the highest-z survivor, not the newest-created", () => {
    // Spawn 3 windows. Manually focus the OLDEST to bump its z above the others,
    // then close it — focus must fall to the next-highest-z (middle one),
    // not to the youngest (which was created last but never re-focused).
    const a = openWindow("settings", "Settings"); // created first
    const b = openWindow("monitor", "Monitor");
    const c = openWindow("files", "Files", undefined, { path: "/x" }, { multi: true });
    focusWindow(a); // a now has the top z
    expect(shellStore.getFocused()).toBe(a);

    // b was created before c, so by creation order b is older than c.
    // By z, after focusWindow(a), the order high→low is: a, c, b.
    closeWindow(a);
    // Highest-z survivor is c (created last, but more importantly: higher z than b).
    expect(shellStore.getFocused()).toBe(c);
  });
});
