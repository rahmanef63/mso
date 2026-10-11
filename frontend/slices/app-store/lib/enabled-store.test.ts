import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

let unsubscribe: (() => void) | undefined;
let notified = 0;
vi.mock("react", () => ({ useSyncExternalStore: (subscribe: (cb: () => void) => () => void, snap: () => unknown) => {
  unsubscribe?.(); unsubscribe = subscribe(() => { notified++; }); return snap();
} }));
let storage: Map<string, string>;
let events: EventTarget;
beforeEach(() => {
  vi.resetModules(); storage = new Map(); events = new EventTarget(); notified = 0;
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  vi.stubGlobal("window", events);
});
afterEach(() => { unsubscribe?.(); unsubscribe = undefined; vi.unstubAllGlobals(); });

describe("one installation record across shell presentations", () => {
  it("starts with exactly seven essentials and leaves new apps optional", async () => {
    const store = await import("./enabled-store");
    const state = store.useEnabledOverrides();
    expect(store.ESSENTIAL_APP_IDS.filter(id => store.isAppEnabled(id, state))).toHaveLength(7);
    expect(store.ESSENTIAL_APP_IDS).toEqual(["files-manager", "camoufox-browser", "os-terminal", "app-store", "assistant", "hermes", "os-settings"]);
    for (const id of ["agent-vault", "memory-graph", "organization", "n8n", "a-future-app", "constructor"]) expect(store.isAppEnabled(id, state)).toBe(false);
    expect(storage.size).toBe(0);
  });
  it("preserves valid legacy opt-outs and leaves unrelated user state alone", async () => {
    storage.set("mso:disabled", JSON.stringify(["camoufox-browser", "widgets", "app-store", 3]));
    storage.set("mso:apps", "synthetic custom registry"); storage.set("mso:layout", "synthetic layout");
    const store = await import("./enabled-store"); const state = store.useEnabledOverrides();
    expect(store.isAppEnabled("camoufox-browser", state)).toBe(false); expect(state.widgets).toBe(false);
    expect(store.isAppEnabled("app-store", state)).toBe(true);
    store.setEnabled("n8n", true);
    expect(storage.get("mso:disabled")).toBe(JSON.stringify(["camoufox-browser", "widgets", "app-store", 3]));
    expect(storage.get("mso:apps")).toBe("synthetic custom registry"); expect(storage.get("mso:layout")).toBe("synthetic layout");
    expect(JSON.parse(storage.get("mso:enabled:v1")!)).toMatchObject({ n8n: true, widgets: false });
  });
  it("keeps explicit installs/removals through module reload", async () => {
    let store = await import("./enabled-store"); store.setEnabled("n8n", true); store.setEnabled("os-terminal", false);
    vi.resetModules(); store = await import("./enabled-store"); const state = store.useEnabledOverrides();
    expect(store.isAppEnabled("n8n", state)).toBe(true); expect(store.isAppEnabled("os-terminal", state)).toBe(false);
    expect(store.isAppEnabled("new-optional", state)).toBe(false);
  });
  it("reacts to another tab and ignores unrelated storage changes", async () => {
    const store = await import("./enabled-store"); store.useEnabledOverrides();
    storage.set("mso:enabled:v1", JSON.stringify({ n8n: true }));
    events.dispatchEvent(Object.assign(new Event("storage"), { key: "mso:enabled:v1" }));
    expect(notified).toBe(1); expect(store.isAppEnabled("n8n", store.useEnabledOverrides())).toBe(true);
    events.dispatchEvent(Object.assign(new Event("storage"), { key: "sv:shell" })); expect(notified).toBe(1);
    store.setEnabled("n8n", false); expect(store.isAppEnabled("n8n", store.useEnabledOverrides())).toBe(false);
  });
  it("keeps App Store available and validates stored overrides", async () => {
    const store = await import("./enabled-store");
    expect(store.parseEnabled(["n8n"])).toEqual({});
    expect(store.parseEnabled(JSON.parse('{"n8n":true,"bad":"yes","__proto__":false,"invalid/id":true}'))).toEqual({ n8n: true });
    store.setEnabled("app-store", false); store.setEnabled("../bad", true); expect(storage.size).toBe(0);
  });
  it("recovers corrupt storage and tolerates private-mode writes", async () => {
    storage.set("mso:enabled:v1", "{");
    const store = await import("./enabled-store"); expect(store.useEnabledOverrides()).toEqual({});
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
    expect(() => store.setEnabled("n8n", true)).not.toThrow();
    expect(store.isAppEnabled("n8n", store.useEnabledOverrides())).toBe(true);
  });
});
