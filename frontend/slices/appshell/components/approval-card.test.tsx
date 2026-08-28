import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ApprovalCard, canonicalToolInput } from "./approval-card";
import type { ChatMessage } from "./message-bubble";

function card(name: string, input: Record<string, unknown>): ChatMessage {
  return {
    id: "approval-test",
    role: "tool",
    text: "",
    tool: { name, input, effect: "mutate", status: "pending" },
  };
}

describe("approval argument disclosure", () => {
  it("renders the full fs.write body before the Approve button", () => {
    const content = `prefix-${"x".repeat(4_096)}-suffix`;
    const html = renderToStaticMarkup(<ApprovalCard message={card("fs.write", { path: "/tmp/full.txt", content })} onResolve={vi.fn()} />);
    expect(html).toContain("prefix-");
    expect(html).toContain("-suffix");
    expect(html).not.toContain(`${content.slice(0, 2_000)}…`);
    expect(html.indexOf("-suffix")).toBeLessThan(html.indexOf("Approve"));
  });

  it("renders complete copy/delete paths without summary truncation", () => {
    const from = `/source/${"a".repeat(600)}`;
    const to = `/destination/${"b".repeat(600)}`;
    const copy = renderToStaticMarkup(<ApprovalCard message={card("fs.copy", { from, to })} onResolve={vi.fn()} />);
    const del = renderToStaticMarkup(<ApprovalCard message={card("fs.delete", { path: to })} onResolve={vi.fn()} />);
    expect(copy).toContain(from);
    expect(copy).toContain(to);
    expect(del).toContain(to);
  });

  it("uses the same complete canonical object representation for generic mutations", () => {
    const input = { text: "remember this exactly", nested: { provider: "future-provider" } };
    const html = renderToStaticMarkup(<ApprovalCard message={card("memory.remember", input)} onResolve={vi.fn()} />);
    for (const fragment of ["remember this exactly", "future-provider"]) expect(html).toContain(fragment);
    expect(canonicalToolInput(input)).toBe(JSON.stringify(input, null, 2));
  });
});
