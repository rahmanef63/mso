import { describe, expect, it } from "vitest";
import { filterSettingsSections, groupSettingsSections, sectionFromSearch, settingsBackTarget, settingsNavActive, settingsSection, SECTIONS } from "./sections";

describe("settings section model", () => {
  it("filters metadata without depending on a renderer", () => {
    expect(filterSettingsSections("chatgpt").map((x) => x.id)).toEqual(["mcp"]);
    expect(filterSettingsSections("wallpaper").map((x) => x.id)).toEqual(["appearance"]);
    expect(filterSettingsSections("devices").map((x) => x.id)).toEqual(["devices"]);
    expect(filterSettingsSections("system info").map((x) => x.id)).toEqual(["account"]);
    expect(filterSettingsSections("version").map((x) => x.id)).toEqual(["updates"]);
    expect(filterSettingsSections("updates").map((x) => x.id)).toEqual(["updates"]);
  });

  it("lists Devices as its own system section and keeps no Server section", () => {
    expect(SECTIONS.map((section) => section.id)).toContain("devices");
    expect(SECTIONS.map((section) => section.id)).not.toContain("server");
    expect(SECTIONS.map((section) => section.id)).not.toContain("about");
    expect(groupSettingsSections().map((group) => group.map((x) => x.id))).toEqual([
      ["account", "appearance", "theme"],
      ["ai", "quicklinks", "mcp", "a2a"],
      ["devices", "cleanup", "backup", "updates"],
    ]);
    expect(SECTIONS.at(-1)?.id).toBe("updates");
  });

  it("folds the old Server section into Devices", () => {
    expect(settingsSection("devices")).toMatchObject({ label: "Devices", blurb: "This server, approved browsers, and auto-lock" });
    // Old deep link and old search vocabulary must keep resolving.
    expect(sectionFromSearch("server")).toBe("devices");
    expect(sectionFromSearch("devices")).toBe("devices");
    expect(filterSettingsSections("ssh").map((x) => x.id)).toEqual(["devices"]);
    expect(filterSettingsSections("server").map((x) => x.id)).toEqual(["devices"]);
  });

  it("keeps About nested inside Account", () => {
    expect(settingsSection("account")).toMatchObject({ label: "Account" });
    expect(settingsSection("about")).toMatchObject({ label: "About", blurb: "System info and reset" });
    expect(sectionFromSearch("about")).toBe("about");
    expect(settingsNavActive("account", "about")).toBe(true);
    expect(settingsNavActive("account", "devices")).toBe(false);
    expect(settingsNavActive("devices", "devices")).toBe(true);
    expect(settingsBackTarget("about")).toBe("account");
    // Devices is top level now, so it has no back target.
    expect(settingsBackTarget("devices")).toBeNull();
    expect(settingsBackTarget("appearance")).toBeNull();
  });
});
