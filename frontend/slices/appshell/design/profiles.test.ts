import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SHELL_DESIGN_PROFILES } from "./profiles";

describe("shell design profiles", () => {
  it("defines one explicit design profile and design.md for every shell", () => {
    expect(Object.keys(SHELL_DESIGN_PROFILES).sort()).toEqual(["android", "dashboard", "ios", "macos", "windows"]);
    for (const profile of Object.values(SHELL_DESIGN_PROFILES)) {
      const doc = resolve(process.cwd(), profile.docsPath);
      expect(existsSync(doc), `${profile.id} is missing ${profile.docsPath}`).toBe(true);
      expect(readFileSync(doc, "utf8")).toMatch(/^# .+design\.md/m);
    }
  });

  it("keeps mobile navigation shell-owned and desktop navigation desktop-only", () => {
    expect(SHELL_DESIGN_PROFILES.ios.mobileNavigation).toBe("ios");
    expect(SHELL_DESIGN_PROFILES.android.mobileNavigation).toBe("android");
    expect(SHELL_DESIGN_PROFILES.macos.mobileNavigation).toBe("none");
    expect(SHELL_DESIGN_PROFILES.windows.mobileNavigation).toBe("none");
    expect(SHELL_DESIGN_PROFILES.dashboard.mobileNavigation).toBe("none");
  });

  it("uses native settings navigation per persona", () => {
    expect(SHELL_DESIGN_PROFILES.ios.settingsNavigation).toBe("ios-stack");
    expect(SHELL_DESIGN_PROFILES.android.settingsNavigation).toBe("android-stack");
    expect(SHELL_DESIGN_PROFILES.macos.settingsNavigation).toBe("macos-sidebar");
    expect(SHELL_DESIGN_PROFILES.windows.settingsNavigation).toBe("windows-tabs");
    expect(SHELL_DESIGN_PROFILES.dashboard.settingsNavigation).toBe("dashboard-tabs");
  });
});
