import { describe, expect, it } from "vitest";
import { filterSettingsSections, groupSettingsSections, settingsSection } from "./sections";

describe("settings section model", () => {
  it("filters metadata without depending on a renderer", () => {
    expect(filterSettingsSections("chatgpt").map((x) => x.id)).toEqual(["mcp"]);
    expect(filterSettingsSections("wallpaper").map((x) => x.id)).toEqual(["appearance"]);
  });

  it("groups by semantic category instead of array indexes", () => {
    expect(groupSettingsSections().map((group) => group.map((x) => x.id))).toEqual([
      ["appearance", "theme"],
      ["ai", "quicklinks", "mcp", "a2a"],
      ["devices", "server", "cleanup", "backup", "about"],
    ]);
  });

  it("keeps About content identity separate from the category metadata", () => {
    expect(settingsSection("about")).toMatchObject({ label: "About", blurb: "System info and reset" });
  });
});
