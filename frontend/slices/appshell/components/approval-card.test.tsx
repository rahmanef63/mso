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

describe("human-readable tool identity (OpenDots parity)", () => {
  it("shows a human label + state word, with the raw name kept for audit", () => {
    const write = renderToStaticMarkup(<ApprovalCard message={card("fs.write", { path: "/tmp/a" })} onResolve={vi.fn()} />);
    expect(write).toContain("Saving file");
    expect(write).toContain("fs.write");
    expect(write).toContain("Needs your approval");
    const exec = renderToStaticMarkup(<ApprovalCard message={card("exec.run", { cmd: "ls" })} onResolve={vi.fn()} />);
    expect(exec).toContain("Running command");
  });

  it("falls back to the raw name for an unknown tool", () => {
    const html = renderToStaticMarkup(<ApprovalCard message={card("future.tool", {})} onResolve={vi.fn()} />);
    expect(html).toContain("future.tool");
  });

  it("uses Denied, never Failed, for a denied call", () => {
    const denied: ChatMessage = {
      id: "d",
      role: "tool",
      text: "",
      tool: { name: "fs.delete", input: { path: "/tmp/x" }, effect: "mutate", status: "denied" },
    };
    const html = renderToStaticMarkup(<ApprovalCard message={denied} onResolve={vi.fn()} />);
    expect(html).toContain("Deleting file");
    expect(html).toContain("Denied");
  });

  it("collapses completed ok tool steps into a compact toggle row by default", () => {
    const done: ChatMessage = {
      id: "ok-1",
      role: "tool",
      text: "",
      tool: { name: "fs.list", input: { path: "/srv/app" }, effect: "read", status: "ok", result: "file1.ts" },
    };
    const html = renderToStaticMarkup(<ApprovalCard message={done} onResolve={vi.fn()} />);
    expect(html).toContain("Listing files");
    expect(html).toContain("Finished");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("file1.ts");
  });
});

