import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { LIST_TOOLS } = await import("./tools-list");
const { MSO_LIST_URI } = await import("./ui-list");
const tool = LIST_TOOLS.find((row) => row.name === "render_mso_list")!;

describe("render_mso_list", () => {
  it("is a read-only explicit render tool bound only to the List resource", () => {
    expect(tool.scope).toBe("read");
    expect(tool.meta).toMatchObject({ ui: { resourceUri: MSO_LIST_URI, visibility: ["model", "app"] } });
    expect(tool.meta?.["openai/outputTemplate"]).toBeUndefined();
  });

  it("normalizes bounded model-selected collection data without executing actions", async () => {
    const result = await tool.run({
      title: "Projects",
      layout: "grid",
      searchable: true,
      items: Array.from({ length: 45 }, (_, index) => ({
        id: `p-${index}`,
        title: `Project ${index}`,
        subtitle: "x".repeat(700),
        icon: "project",
        status: index ? "success" : "invalid",
        meta: Array.from({ length: 8 }, (_, meta) => ({ label: `M${meta}`, value: "v" })),
        actions: [{ label: "Open", prompt: "Open this project with render_mso_page." }, { label: "Inspect", prompt: "Inspect it." }, { label: "Overflow", prompt: "No." }],
      })),
    }, {} as never) as any;
    expect(result.title).toBe("Projects");
    expect(result.layout).toBe("grid");
    expect(result.searchable).toBe(true);
    expect(result.items).toHaveLength(40);
    expect(result.items[0].status).toBe("neutral");
    expect(result.items[0].subtitle).toHaveLength(500);
    expect(result.items[0].meta).toHaveLength(4);
    expect(result.items[0].actions).toHaveLength(2);
  });
});
