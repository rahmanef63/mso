import { beforeEach, describe, expect, it, vi } from "vitest";
import { configureWindowTitle, startWindowTitleSync } from "./window-title";
import { closeAll, closeWindow, openWindow } from "./store";

vi.stubGlobal("window", Object.assign(globalThis.window ?? {}, { innerWidth: 1280, innerHeight: 800 }));
vi.stubGlobal("document", { title: "Base Title" });

describe("window-title sync", () => {
  beforeEach(() => {
    closeAll();
    configureWindowTitle({ suffix: "Brand" });
    startWindowTitleSync();
  });

  it("follows the focused window with the brand suffix", () => {
    openWindow("files", "Files");
    expect(document.title).toBe("Files: Brand");
    openWindow("settings", "Settings");
    expect(document.title).toBe("Settings: Brand");
  });

  it("restores the captured base title when nothing is focused", () => {
    const id = openWindow("files", "Files");
    closeWindow(id);
    expect(document.title).toBe("Base Title");
  });

  it("skips the suffix when the window title IS the brand", () => {
    openWindow("home", "Brand");
    expect(document.title).toBe("Brand");
  });
});
