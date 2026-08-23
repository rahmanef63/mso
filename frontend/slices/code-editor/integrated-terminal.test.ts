import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Code integrated terminal", () => {
  it("exposes a terminal toggle and mounts the shared terminal panel", () => {
    const app = readFileSync(new URL("./app.tsx", import.meta.url), "utf8");
    const toolbar = readFileSync(new URL("./components/editor-toolbar.tsx", import.meta.url), "utf8");
    expect(app).toContain("<IntegratedTerminal");
    expect(app).toContain("terminalOpen");
    expect(toolbar).toContain("Toggle integrated terminal");
  });
});
