import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const read = (path: string) => readFileSync(path, "utf8");
describe("shell graph loading boundaries", () => {
  it("preserves the public Organization API without eagerly exporting the canvas view", () => {
    const barrel = read("frontend/slices/organization/index.ts");
    expect(barrel).toContain('load: () => import("./app")');
    expect(barrel).toContain('from "./lazy-view"');
    expect(barrel).not.toContain('from "./components/organization-view"');
    expect(read("frontend/slices/organization/lazy-view.tsx")).toContain('import("./components/organization-view")');
  });
  it("loads graph CSS at the shared canvas boundary rather than in global CSS", () => {
    expect(read("app/globals.css")).not.toContain("@xyflow/react");
    expect(read("components/shared/graph-canvas.tsx")).toContain('import "@xyflow/react/dist/style.css"');
  });
  it("keeps lock protection, notification plumbing and clipboard capture eager", () => {
    // The invariant is that auto-lock is ARMED at boot, not that the curtain's markup ships in the
    // first-load bundle. The timer moved to appshell/provider (useIdleAutoLock) precisely so the
    // presentation can be deferred without deferring the protection.
    expect(read("frontend/slices/appshell/provider/app-shell.tsx")).toContain("useIdleAutoLock()");
    expect(read("frontend/slices/appshell/lib/use-idle-auto-lock.ts")).toContain("setTimeout(lock");
    expect(read("frontend/slices/appshell/lib/use-idle-auto-lock.ts")).toContain("autoLockMinutes");
    expect(read("frontend/slices/appshell/features/lock-screen/index.ts")).not.toContain('from "./components/lock-screen"');
    expect(read("frontend/slices/appshell/features/notifications/index.ts")).toContain('from "./components/toast-host"');
    const clipboard = read("frontend/slices/appshell/features/clipboard/components/clipboard-overlay.tsx");
    expect(clipboard).toContain("useEffect(() => startClipboardCapture(), [])");
    expect(clipboard).toContain('window.addEventListener("keydown", onKey)');
    expect(clipboard).toContain('import("./clipboard-panel")');
  });
  it("keeps native links, normal app loading and restrictive prefetch guards", () => {
    for (const name of ["dock-parts", "app-launcher"]) {
      const source = read(`frontend/slices/appshell/components/${name}.tsx`);
      expect(source).toContain("prefetch={false}");
      expect(source).toContain("onPointerLeave={prefetch.cancel}");
      expect(source).toContain("onBlur={prefetch.cancel}");
      expect(source).not.toContain("onPointerEnter={() => void app.load");
    }
    expect(read("frontend/slices/appshell/components/window-content.tsx")).toContain(".load()");
  });
});
