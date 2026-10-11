import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDescriptor } from "../lib/types";

const mocks = vi.hoisted(() => ({
  pathname: "/notes/fixture", effects: [] as (() => void)[],
  open: vi.fn(), focus: vi.fn(), getWindow: vi.fn(), refs: [] as { current: unknown }[], refN: 0,
}));
// Run the real URL effects without mounting presentation or requiring a DOM.
vi.mock("react", () => ({
  useEffect: (effect: () => void) => { mocks.effects.push(effect); },
  useRef: (value: unknown) => mocks.refs[mocks.refN++] ??= { current: value },
  useLayoutEffect: (effect: () => void) => { mocks.effects.push(effect); },
}));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
vi.mock("../hooks/use-shell", () => ({ useFocused: () => null, useWindow: () => mocks.getWindow() }));
vi.mock("../lib/store", () => ({
  openWindow: mocks.open, focusApp: mocks.focus,
  shellStore: { getFocused: () => null, getWindow: mocks.getWindow },
}));
import { UrlSync } from "./use-url-sync";

const app = (id: string, slug = id): AppDescriptor => ({
  id, slug, title: id, icon: () => null, gradient: "var(--primary)",
  load: vi.fn().mockResolvedValue({ default: () => null }),
});
function boot(apps: AppDescriptor[]) {
  mocks.effects = []; mocks.refN = 0;
  UrlSync({ apps });
  mocks.effects.forEach(effect => effect());
}

describe("requested app starts alongside its shell", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.effects = []; mocks.refs = []; mocks.refN = 0; mocks.pathname = "/notes/fixture";
    mocks.focus.mockReturnValue(false); mocks.getWindow.mockReturnValue(undefined);
  });
  it("starts only the deep-linked import before opening its window", () => {
    const notes = app("vault", "notes"), other = app("terminal");
    boot([notes, other]);
    expect(notes.load).toHaveBeenCalledOnce(); expect(other.load).not.toHaveBeenCalled();
    expect(vi.mocked(notes.load).mock.invocationCallOrder[0]).toBeLessThan(mocks.open.mock.invocationCallOrder[0]);
    expect(mocks.open).toHaveBeenCalledWith("vault", "vault", undefined, { path: "/fixture" });
  });
  it.each(["/", "/unknown"])("does not import an app for %s", pathname => {
    mocks.pathname = pathname; const notes = app("vault", "notes"); boot([notes]);
    expect(notes.load).not.toHaveBeenCalled(); expect(mocks.open).not.toHaveBeenCalled();
  });
  it("reuses an existing window and retains its deep-link payload", () => {
    mocks.focus.mockReturnValue(true); const notes = app("vault", "notes"); boot([notes]);
    expect(notes.load).toHaveBeenCalledOnce();
    expect(mocks.focus).toHaveBeenCalledWith("vault", { path: "/fixture" });
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it("does not reload an already visible app", () => {
    mocks.getWindow.mockReturnValue({ app: "vault", minimized: false });
    const notes = app("vault", "notes"); boot([notes]);
    expect(notes.load).not.toHaveBeenCalled(); expect(mocks.open).not.toHaveBeenCalled();
  });
  it("keeps an uninstalled deep link free of module loading", () => {
    const notes = { ...app("vault", "notes"), installed: false };
    boot([notes]); expect(notes.load).not.toHaveBeenCalled();
    expect(mocks.open).toHaveBeenCalledOnce();
  });
  it("starts the requested import when persisted installation hydrates after its window", () => {
    const notes = { ...app("vault", "notes"), installed: false };
    boot([notes]); mocks.getWindow.mockReturnValue({ app: "vault", minimized: false, payload: { path: "/fixture" } });
    boot([{ ...notes, installed: true }]);
    expect(notes.load).toHaveBeenCalledOnce(); expect(mocks.open).toHaveBeenCalledOnce();
    boot([{ ...notes, installed: true }]); expect(notes.load).toHaveBeenCalledOnce();
  });
  it("keeps opening the window after an early import fails, allowing its loader to retry", async () => {
    const notes = app("vault", "notes");
    vi.mocked(notes.load).mockRejectedValueOnce(new Error("synthetic chunk failure"));
    boot([notes]); await Promise.resolve();
    expect(mocks.open).toHaveBeenCalledOnce();
    await expect(notes.load()).resolves.toHaveProperty("default");
  });
});
