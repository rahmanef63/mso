import { describe, expect, it } from "vitest";
import { appAllowedForRole } from "./app-access";

describe("role-aware app catalog", () => {
  it("keeps Viewer on read-oriented workspace surfaces", () => {
    for (const id of ["files-manager", "system-monitor", "media-viewer", "quicklinks", "docs", "os-settings"]) {
      expect(appAllowedForRole(id, "viewer"), id).toBe(true);
    }
    for (const id of ["os-terminal", "code-editor", "assistant", "hermes", "camoufox-browser"]) {
      expect(appAllowedForRole(id, "viewer"), id).toBe(false);
    }
  });

  it("adds only bounded operational apps for Operator", () => {
    for (const id of ["camoufox-browser", "hermes", "openclaw", "9router"]) {
      expect(appAllowedForRole(id, "operator"), id).toBe(true);
    }
    for (const id of ["os-terminal", "code-editor", "assistant", "app-store", "create-app"]) {
      expect(appAllowedForRole(id, "operator"), id).toBe(false);
    }
  });

  it("allows every app for Owner and fails unknown apps closed otherwise", () => {
    expect(appAllowedForRole("future-runtime-app", "owner")).toBe(true);
    expect(appAllowedForRole("future-runtime-app", "operator")).toBe(false);
    expect(appAllowedForRole("future-runtime-app", "viewer")).toBe(false);
    expect(appAllowedForRole("future-runtime-app", null)).toBe(false);
  });
});
