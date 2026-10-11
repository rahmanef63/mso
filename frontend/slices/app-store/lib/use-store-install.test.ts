import { afterEach, describe, expect, it, vi } from "vitest";
const { close, focus, enable, getWindow, getOrder, states } = vi.hoisted(() => ({
  close: vi.fn(), focus: vi.fn(), enable: vi.fn(), getWindow: vi.fn(), getOrder: vi.fn(), states: [] as unknown[],
}));
vi.mock("react", () => ({ useCallback: (fn: unknown) => fn, useState: () => [states.shift(), vi.fn()] }));
vi.mock("@/features/appshell", () => ({ closeWindow: close, focusWindow: focus, shellStore: { getOrder, getWindow } }));
vi.mock("./enabled-store", () => ({ setEnabled: enable, isAppEnabled: () => true }));
vi.mock("./apps-store", () => ({ setInstalled: vi.fn() }));
import { useStoreInstall } from "./use-store-install";
afterEach(() => { vi.resetAllMocks(); states.length = 0; });
describe("uninstall respects existing window close guards", () => {
  it("keeps the app installed and focuses an editor with an unsaved draft", () => {
    states.push(null, { id: "code-editor", kind: "app" });
    getOrder.mockReturnValue(["draft"]); getWindow.mockReturnValue({ app: "code-editor" });
    useStoreInstall({}).confirmUninstallSystem();
    expect(close).toHaveBeenCalledWith("draft"); expect(enable).not.toHaveBeenCalled(); expect(focus).toHaveBeenCalledWith("draft");
  });
  it("removes only menu availability after all app windows close", () => {
    states.push(null, { id: "code-editor", kind: "app" });
    getOrder.mockReturnValue(["saved"]); getWindow.mockReturnValueOnce({ app: "code-editor" }).mockReturnValue(undefined);
    useStoreInstall({}).confirmUninstallSystem();
    expect(close).toHaveBeenCalledWith("saved"); expect(enable).toHaveBeenCalledWith("code-editor", false); expect(focus).not.toHaveBeenCalled();
  });
});
