import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeAll, openWindow, moveWindow, resizeWindow, toggleMaximize, minimizeWindow, snapWindow, retileSnapped, applyChromeInsets, serialize, hydrate } from "./store";
import { shellStore } from "./store-state";
import { parseLayout } from "./parse-layout";

function viewport(w: number, h: number) { vi.stubGlobal("window", { innerWidth: w, innerHeight: h }); }
beforeEach(() => { viewport(1920, 1080); closeAll(); applyChromeInsets({ top: 34, bottom: 92 }); });
afterEach(() => { closeAll(); vi.unstubAllGlobals(); });

describe("preferred workspace geometry", () => {
  it("restores desktop size after phone rotation and a saved-layout reload", () => {
    const id = openWindow("editor", "Editor", { w: 1100, h: 700 });
    moveWindow(id, 160, 80);
    viewport(390, 844); retileSnapped();
    expect(shellStore.getWindow(id)?.w).toBe(374);
    moveWindow(id, 8, 8);
    expect(shellStore.getWindow(id)?.preferredRect?.w).toBe(1100);
    moveWindow(id, 160, 80);
    const saved = parseLayout(JSON.stringify(serialize()));
    hydrate(saved);
    viewport(1920, 1080); retileSnapped();
    expect(shellStore.getWindow(id)).toMatchObject({ x: 160, y: 80, w: 1100, h: 700 });
  });
  it("preserves the requested size when first opened on a small viewport", () => {
    viewport(320, 568);
    const id = openWindow("files", "Files", { w: 900, h: 650 });
    viewport(1920, 1080); retileSnapped();
    expect(shellStore.getWindow(id)).toMatchObject({ w: 900, h: 650 });
  });
  it("updates intent on explicit resize and restores it after maximize", () => {
    const id = openWindow("files", "Files");
    resizeWindow(id, 920, 600); toggleMaximize(id);
    viewport(390, 844); retileSnapped(); toggleMaximize(id);
    expect(shellStore.getWindow(id)?.w).toBe(374);
    viewport(1920, 1080); retileSnapped();
    expect(shellStore.getWindow(id)).toMatchObject({ w: 920, h: 600, maximized: false });
  });
  it("reflows minimized windows and publishes one atomic geometry update", () => {
    const a = openWindow("a", "A"), b = openWindow("b", "B");
    minimizeWindow(a); snapWindow(b, "right");
    const listener = vi.fn(), off = shellStore.subscribe(listener);
    viewport(390, 844); retileSnapped();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(shellStore.getWindow(a)?.w).toBe(374);
    expect(shellStore.getWindow(b)?.x).toBeGreaterThan(0);
    off();
  });
  it("does not emit or rewrite state when geometry is unchanged", () => {
    openWindow("a", "A");
    const listener = vi.fn(), off = shellStore.subscribe(listener);
    retileSnapped(); retileSnapped();
    expect(listener).not.toHaveBeenCalled(); off();
  });
});

describe("saved layout validation", () => {
  it("keeps valid legacy windows while rejecting malformed and duplicate records", () => {
    openWindow("a", "A"); const valid = serialize()[0];
    const legacy = { ...valid, preferredRect: undefined };
    expect(parseLayout(JSON.stringify([null, {}, legacy, legacy, { ...valid, id: "bad", w: -1 }, { ...valid, id: "zone", snapZone: "unknown" }]))).toEqual([legacy]);
  });
  it("rejects malformed geometry and accepts an empty workspace", () => {
    openWindow("a", "A"); const valid = serialize()[0];
    expect(parseLayout(JSON.stringify([{ ...valid, preferredRect: { x: 0, y: 0, w: null, h: 1 } }]))).toEqual([]);
    expect(parseLayout("{}")).toEqual([]);
    expect(parseLayout("[]")).toEqual([]);
  });
});
