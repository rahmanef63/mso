import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./components/project-flow.tsx", import.meta.url), "utf8");

describe("Organization project-flow UX contract", () => {
  it("starts dense project flows in bounded Focus mode and keeps Map explicit", () => {
    expect(source).toContain('useState<ViewMode>("focus")');
    expect(source).toContain('viewMode === "map"');
    expect(source).toContain('maxNodes: focusDepth > 1 ? 24 : 12');
    expect(source).toContain("fallbackLimit: 1");
    expect(source).toContain(">Map</Button>");
    expect(source).toContain("Expand neighbors");
    expect(source).toContain("Collapse cluster");
  });

  it("moves selected details into a static side inspector on roomy panes", () => {
    expect(source).toContain('@min-[920px]:grid-cols-[minmax(0,1fr)_320px]');
    expect(source).toContain("@min-[920px]:static");
  });
});
