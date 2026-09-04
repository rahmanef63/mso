import { describe, expect, it } from "vitest";
import { BLOCK_TOOLS } from "./tools-block";
import { MSO_BLOCK_URI } from "./ui-block";

const tool = BLOCK_TOOLS.find((row) => row.name === "render_mso_block");
if (!tool) throw new Error("missing render_mso_block");

describe("MSO Block MCP tool", () => {
  it("normalizes bounded validation and CRUD input-output", async () => {
    const result = await tool.run({
      kind: "crud",
      title: "Edit deployment",
      description: "Review values before updating production.",
      status: "warning",
      fields: [
        { id: "domain", label: "Domain", value: "example.com", input: "url", required: true },
        { id: "enabled", label: "Enabled", value: true, input: "boolean" },
      ],
      checks: [{ label: "DNS", state: "pass", detail: "Resolved" }],
      outputs: [{ label: "Environment", value: "production" }],
      actions: [{ id: "save", label: "Save", style: "primary", prompt: "Apply the reviewed deployment update." }],
    }, { scope: "read" }) as Record<string, unknown>;

    expect(result).toMatchObject({
      kind: "crud",
      title: "Edit deployment",
      status: "warning",
      fields: [
        { id: "domain", label: "Domain", value: "example.com", input: "url", editable: true, required: true },
        { id: "enabled", label: "Enabled", value: true, input: "boolean", editable: true, required: false },
      ],
      checks: [{ label: "DNS", state: "pass", detail: "Resolved" }],
      outputs: [{ label: "Environment", value: "production" }],
      actions: [{ id: "save", label: "Save", style: "primary", prompt: "Apply the reviewed deployment update." }],
    });
  });

  it("exposes only the Block resource and never accepts raw HTML or executable tool names", () => {
    expect(tool.inputSchema.properties).not.toHaveProperty("html");
    expect(tool.inputSchema.properties).not.toHaveProperty("url");
    expect(tool.inputSchema.properties).not.toHaveProperty("tool");
    expect(tool.meta).toMatchObject({
      ui: { resourceUri: MSO_BLOCK_URI, visibility: ["model", "app"] },
      "openai/outputTemplate": MSO_BLOCK_URI,
    });
    expect(JSON.stringify(tool.inputSchema)).toContain("Follow-up instruction");
  });

  it("bounds arrays and text while preserving explicit destructive confirmation copy", async () => {
    const result = await tool.run({
      kind: "action",
      title: "Delete rows",
      fields: Array.from({ length: 30 }, (_, index) => ({ id: `row-${index}`, label: `Row ${index}`, value: index })),
      checks: Array.from({ length: 30 }, (_, index) => ({ label: `Check ${index}`, state: "info" })),
      outputs: Array.from({ length: 30 }, (_, index) => ({ label: `Output ${index}`, value: index })),
      actions: Array.from({ length: 12 }, (_, index) => ({
        id: `action-${index}`,
        label: `Action ${index}`,
        style: index === 0 ? "danger" : "secondary",
        prompt: "x".repeat(2_000),
        confirm: index === 0 ? "Delete the selected rows?" : undefined,
      })),
    }, { scope: "read" }) as {
      fields: unknown[]; checks: unknown[]; outputs: unknown[];
      actions: Array<{ prompt: string; confirm?: string }>;
    };

    expect(result.fields).toHaveLength(20);
    expect(result.checks).toHaveLength(20);
    expect(result.outputs).toHaveLength(20);
    expect(result.actions).toHaveLength(8);
    expect(result.actions[0].prompt).toHaveLength(1_200);
    expect(result.actions[0].confirm).toBe("Delete the selected rows?");
  });
});
