import { describe, expect, it } from "vitest";
import { filterSettingsSections, groupSettingsSections, sectionFromSearch, settingsBackTarget, settingsNavActive, settingsSection, SECTIONS } from "./sections";

describe("settings section model", () => {
  it("filters metadata without depending on a renderer", () => {
    expect(filterSettingsSections("chatgpt").map((x) => x.id)).toEqual(["mcp"]);
    expect(filterSettingsSections("wallpaper").map((x) => x.id)).toEqual(["appearance"]);
    expect(filterSettingsSections("devices").map((x) => x.id)).toEqual(["account"]);
    expect(filterSettingsSections("system info").map((x) => x.id)).toEqual(["account"]);
    expect(filterSettingsSections("version").map((x) => x.id)).toEqual(["account"]);
    expect(filterSettingsSections("updates").map((x) => x.id)).toEqual(["account"]);
  });

  it("groups Account with personalization and keeps Devices and About nested", () => {
    expect(SECTIONS.map((section) => section.id)).not.toContain("devices");
    expect(SECTIONS.map((section) => section.id)).not.toContain("about");
    expect(groupSettingsSections().map((group) => group.map((x) => x.id))).toEqual([
      ["account", "appearance", "theme"],
      ["ai", "quicklinks", "mcp", "a2a"],
      ["server", "cleanup", "backup"],
    ]);
  });

  it("opens Devices and About from Account, including old deep links", () => {
    expect(settingsSection("account")).toMatchObject({ label: "Account" });
    expect(settingsSection("about")).toMatchObject({ label: "About", blurb: "System info and reset" });
    expect(settingsSection("devices").label).toBe("Devices");
    expect(sectionFromSearch("devices")).toBe("devices");
    expect(sectionFromSearch("about")).toBe("about");
    expect(settingsNavActive("account", "about")).toBe(true);
    expect(settingsNavActive("server", "about")).toBe(false);
    expect(settingsBackTarget("devices")).toBe("account");
    expect(settingsBackTarget("appearance")).toBeNull();
  });
});
