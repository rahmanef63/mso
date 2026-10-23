import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import {
  ModelPickerBody,
  isStaleSelection,
  modelOptionText,
  modelOptions,
  modelsFromResponse,
  type ModelLoad,
} from "./model-quick-control";

// Radix portals do not render server-side and SelectItem needs Select context, so
// the primitive is a plain element here. These tests assert the three-state model
// picker markup, which is where complaint 3 lives.
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: ReactNode }) => <div data-slot="select">{children}</div>,
  SelectTrigger: ({ children, ...props }: { children: ReactNode } & Record<string, unknown>) => (
    <div data-slot="select-trigger" {...props}>{children}</div>
  ),
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span data-slot="select-value">{placeholder ?? ""}</span>,
  SelectContent: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div data-slot="select-content" className={className}>{children}</div>
  ),
  SelectGroup: ({ children }: { children: ReactNode }) => <div data-slot="select-group">{children}</div>,
  SelectItem: ({ children }: { children: ReactNode }) => <div data-slot="select-item">{children}</div>,
  SelectLabel: ({ children }: { children: ReactNode }) => <div data-slot="select-label">{children}</div>,
}));

const noop = () => {};
const rows = [{ id: "gpt-4o", name: "GPT-4o" }, { id: "o3", name: "o3" }];

function picker(load: ModelLoad, modelRows = rows, activeModel = "gpt-4o") {
  return renderToStaticMarkup(
    <ModelPickerBody
      load={load} rows={modelRows} activeModel={activeModel} provider="ai-hub"
      saving={false} discovering={false} onReload={noop} onDiscover={noop} onSelect={noop}
    />,
  );
}

describe("model picker states", () => {
  it("renders an error with a retry — never an empty list — when the fetch fails", () => {
    const html = picker({ state: "error", error: "HTTP 500" });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Couldn’t load");
    expect(html).toContain("HTTP 500");
    expect(html).toContain("Retry");
    expect(html).not.toContain("reports no models");
    expect(html).not.toContain("select-item");
  });

  it("renders an explicit empty state with a Discover affordance for a provider with zero models", () => {
    const html = picker({ state: "ok" }, []);
    expect(html).toContain("reports no models");
    expect(html).toContain("Discover");
    expect(html).not.toContain("select-item");
    expect(html).not.toContain('role="alert"');
  });

  it("renders the real catalog, marking the selection that is current", () => {
    const html = picker({ state: "ok" });
    expect(html).toContain("GPT-4o (current)");
    expect(html).toContain("o3");
    expect(html).not.toContain("Retry");
    expect(html).not.toContain("reports no models");
  });

  it("shows a loading placeholder rather than an empty list while fetching", () => {
    const html = picker({ state: "loading" });
    expect(html).toContain("Loading models…");
    expect(html).not.toContain("reports no models");
  });
});

describe("model switch honesty", () => {
  it("distinguishes a failed fetch from an empty provider", () => {
    expect(modelsFromResponse(500, {})).toEqual({ load: { state: "error", error: "HTTP 500" }, rows: [] });
    expect(modelsFromResponse(401, {})).toEqual({ load: { state: "error", error: "HTTP 401" }, rows: [] });
    expect(modelsFromResponse(200, { models: [] })).toEqual({ load: { state: "ok" }, rows: [] });
    expect(modelsFromResponse(200, { models: rows })).toEqual({ load: { state: "ok" }, rows });
    expect(modelsFromResponse(200, {})).toEqual({ load: { state: "ok" }, rows: [] });
  });

  it("keeps the saved model selectable when a refresh drops it", () => {
    expect(modelOptions(rows, "gpt-4o")).toBe(rows);
    expect(modelOptions(rows, "gone").map((row) => row.id)).toEqual(["gone", "gpt-4o", "o3"]);
    expect(modelOptions([], "gone").map((row) => row.id)).toEqual(["gone"]);
  });

  it("reports a stale selection instead of silently picking another model", () => {
    expect(isStaleSelection({ state: "ok" }, rows, "gone")).toBe(true);
    expect(isStaleSelection({ state: "ok" }, rows, "gpt-4o")).toBe(false);
    expect(isStaleSelection({ state: "error" }, rows, "gone")).toBe(false);
    expect(isStaleSelection({ state: "ok" }, [], "gone")).toBe(false);
    expect(isStaleSelection({ state: "ok" }, rows, "")).toBe(false);
  });

  it("marks only the selected row as current", () => {
    expect(modelOptionText(rows[0], "gpt-4o")).toBe("GPT-4o (current)");
    expect(modelOptionText(rows[1], "gpt-4o")).toBe("o3");
    expect(modelOptionText({ id: "raw-id" }, "raw-id")).toBe("raw-id (current)");
  });
});
