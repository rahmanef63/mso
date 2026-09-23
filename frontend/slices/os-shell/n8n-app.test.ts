import { describe, expect, it } from "vitest";
import { BUILTIN_APPS } from "./shell.manifest";

describe("n8n app registration", () => {
  it("exposes n8n as a first-class built-in route separate from Workflows", () => {
    const n8n = BUILTIN_APPS.find((item) => item.id === "n8n");
    const workflows = BUILTIN_APPS.find((item) => item.id === "workflows");
    expect(n8n).toBeDefined();
    expect(n8n?.title).toBe("n8n");
    expect(n8n?.slug).toBe("n8n");
    expect(n8n?.pinned).toBe(true);
    expect(workflows?.slug).toBe("workflows");
    expect(n8n?.id).not.toBe(workflows?.id);
  });
});
