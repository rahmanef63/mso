import { beforeEach, describe, expect, it, vi } from "vitest";
import { closeAll, openWindow } from "./store";
import { hydrateBoot } from "./store-persist";
import { shellStore } from "./store-state";
import type { PersistedWindow } from "./types";

// UrlSync's contract — "URL → state must not duplicate the persisted layout's
// window" — is implemented in hydrateBoot (see comment in store-persist.ts).
// UrlSync mounts BEFORE usePersistLayout, so by the time hydrateBoot runs there
// is already a live window for the URL'd app. These tests exercise that
// boot-time dedup directly: open the URL-driven window first (UrlSync's effect),
// then call hydrateBoot with the persisted layout.

vi.stubGlobal("window", Object.assign(globalThis.window ?? {}, {
  innerWidth: 1280,
  innerHeight: 800,
}));

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

const MULTI = new Set(["files"]);

describe("URL→state boot dedup (hydrateBoot multi-app contract)", () => {
  beforeEach(() => closeAll());

  it("URL + persisted layout point at the SAME multi-app path → 1 window", () => {
    // UrlSync ran first: opened the deep-linked files window at /home/operator.
    const live = openWindow(
      "files",
      "Files",
      undefined,
      { path: "/home/operator" },
      { multi: true },
    );
    // Then the persisted layout (also remembers a files window at the same path)
    // hydrates underneath.
    hydrateBoot([pw("wA", "files", { payload: { path: "/home/operator" } })], MULTI);

    const ids = shellStore.getOrder();
    expect(ids).toEqual([live]); // exactly one window, the live one
    expect(shellStore.getFocused()).toBe(live);
    expect(shellStore.getWindow(live)?.payload).toEqual({ path: "/home/operator" });
  });

  it("URL + persisted layout point at DIFFERENT multi-app paths → 2 windows", () => {
    const live = openWindow(
      "files",
      "Files",
      undefined,
      { path: "/home/operator" },
      { multi: true },
    );
    hydrateBoot([pw("wA", "files", { payload: { path: "/tmp" } })], MULTI);

    const ids = shellStore.getOrder();
    expect(ids).toHaveLength(2);
    // Live window keeps focus + stacks on top.
    expect(shellStore.getFocused()).toBe(live);
    const apps = ids.map((id) => shellStore.getWindow(id)!.app).sort();
    expect(apps).toEqual(["files", "files"]);
    const paths = ids.map((id) => (shellStore.getWindow(id)!.payload as { path: string }).path).sort();
    expect(paths).toEqual(["/home/operator", "/tmp"]);
  });

  it("re-opening a multi-app's existing window UPDATES payload (no new window)", () => {
    // UrlSync's URL→state effect calls focusApp first, then openWindow only if
    // focusApp returned false. focusApp on the same app reuses the existing
    // window — but if the URL drove openWindow for the same app+path twice,
    // multi+payload dedup at boot still resolves to ONE window. Mirror the
    // payload-update path: re-call openWindow with multi but the SAME ref id by
    // reopening as single-instance (multi=false), which is what focusApp
    // effectively does when only one window of that app exists.
    const live = openWindow("files", "Files", undefined, { path: "/a" }, { multi: true });
    // Now imagine the URL changes to a different path for the same single app —
    // a singleton reopen updates payload + refocuses without creating a window.
    const same = openWindow("files", "Files", undefined, { path: "/b" });
    expect(same).toBe(live);
    expect(shellStore.getOrder()).toEqual([live]);
    expect(shellStore.getWindow(live)?.payload).toEqual({ path: "/b" });
  });
});
