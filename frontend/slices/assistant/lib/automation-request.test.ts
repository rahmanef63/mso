import { describe, expect, it } from "vitest";
import { composeAutomationRequest } from "./automation-request";
import type { Automation } from "./types";

const auto: Automation = {
  id: "auto-1", name: "Inspect then write", glyph: "sparkles", color: "blue", agentId: "ag-1",
  steps: [
    { tool: "fs.read", argText: "README.md" },
    { tool: "fs.write", argText: "notes.txt with verified summary" },
  ],
};

describe("Alfa automation execution request", () => {
  it("preserves ordered tool intent and explicit approval policy", () => {
    const prompt = composeAutomationRequest(auto, "Ops");
    expect(prompt).toContain("using the Ops persona");
    expect(prompt.indexOf("1. fs.read")).toBeLessThan(prompt.indexOf("2. fs.write"));
    expect(prompt).toContain("README.md");
    expect(prompt).toContain("normal human approval cards");
    expect(prompt).toContain("do not claim success without the tool result");
  });

  it("fails safely at the prompt layer when an automation has no steps", () => {
    expect(composeAutomationRequest({ ...auto, steps: [] }, "Ops")).toContain("No steps are configured; explain that and stop.");
  });
});
