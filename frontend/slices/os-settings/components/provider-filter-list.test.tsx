import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import {
  PROVIDER_FILTER_THRESHOLD,
  PROVIDER_LIST_CONTENT_CLASS,
  PROVIDER_LIST_MAX_HEIGHT_REM,
  ProviderListBody,
  ProviderSelectContent,
  filterProviderGroups,
  type ProviderGroup,
} from "./provider-filter-list";

// The real Radix SelectItem throws outside a SelectContent context and portals
// never render server-side, so the primitives are stubbed with plain elements
// here. That is exactly what is under test: the markup these components emit.
vi.mock("@/components/ui/select", () => ({
  SelectContent: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div data-slot="select-content" className={className}>{children}</div>
  ),
  SelectGroup: ({ children }: { children: ReactNode }) => <div data-slot="select-group">{children}</div>,
  SelectItem: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div data-slot="select-item" className={className}>{children}</div>
  ),
  SelectLabel: ({ children }: { children: ReactNode }) => <div data-slot="select-label">{children}</div>,
}));
vi.mock("@/components/ui/input", () => ({
  Input: ({ className, ...props }: Record<string, unknown>) => <input className={className as string} {...props} />,
}));

const groups: ProviderGroup[] = [
  { label: "Free AI available", rows: [{ id: "groq", text: "Groq · 3 free agent-ready" }] },
  { label: "Other providers", rows: [{ id: "anthropic", text: "Anthropic" }, { id: "openai", text: "OpenAI Platform" }] },
  { label: "Connected", rows: [{ id: "ai-hub", text: "ai-hub (Custom)" }] },
];

const many: ProviderGroup[] = [{
  label: "Other providers",
  rows: Array.from({ length: PROVIDER_FILTER_THRESHOLD + 2 }, (_, i) => ({ id: `p${i}`, text: `Provider ${i}` })),
}];

// The reported bug: the dropdown grew to near-viewport height. Both assertions
// below fail against the old `max-h-(--radix-select-content-available-height)`.
describe("bounded provider list", () => {
  it("caps the content height explicitly and scrolls internally", () => {
    expect(PROVIDER_LIST_MAX_HEIGHT_REM).toBeGreaterThanOrEqual(18);
    expect(PROVIDER_LIST_MAX_HEIGHT_REM).toBeLessThanOrEqual(20);
    expect(PROVIDER_LIST_CONTENT_CLASS).toContain(`max-h-[${PROVIDER_LIST_MAX_HEIGHT_REM}rem]`);
    expect(PROVIDER_LIST_CONTENT_CLASS).toContain("overflow-y-auto");
    expect(PROVIDER_LIST_CONTENT_CLASS).not.toContain("--radix-select-content-available-height");
    const html = renderToStaticMarkup(<ProviderSelectContent groups={groups} />);
    expect(html).toContain(`max-h-[${PROVIDER_LIST_MAX_HEIGHT_REM}rem]`);
    expect(html).toContain("overflow-y-auto");
  });

  it("keeps every option reachable — the cap never drops a row", () => {
    const html = renderToStaticMarkup(<ProviderListBody groups={groups} />);
    for (const group of groups) {
      expect(html).toContain(group.label);
      for (const row of group.rows) expect(html).toContain(row.text);
    }
  });

  it("keeps the 44px coarse-pointer touch target on each option", () => {
    expect(renderToStaticMarkup(<ProviderListBody groups={groups} />)).toContain("min-h-[44px]");
  });
});

describe("provider filter", () => {
  it("hides non-matching options and drops groups whose members all filtered out", () => {
    const filtered = filterProviderGroups(groups, "openai");
    expect(filtered.map((group) => group.label)).toEqual(["Other providers"]);
    expect(filtered[0].rows.map((row) => row.id)).toEqual(["openai"]);
    expect(filterProviderGroups(groups, "zzz")).toEqual([]);
  });

  it("matches the visible text as well as the id, and ignores blank queries", () => {
    expect(filterProviderGroups(groups, "CUSTOM").map((group) => group.label)).toEqual(["Connected"]);
    expect(filterProviderGroups(groups, "  ")).toHaveLength(groups.length);
  });

  it("offers a labelled filter input only once the list is long (keyboard users type, not scroll)", () => {
    expect(renderToStaticMarkup(<ProviderListBody groups={groups} />)).not.toContain("Type to filter");
    const html = renderToStaticMarkup(<ProviderListBody groups={many} filterLabel="Filter providers" />);
    expect(html).toContain("Type to filter");
    expect(html).toContain('aria-label="Filter providers"');
    // The input sits inside the content, above the scroll region, and is not
    // wrapped in a focus trap of its own (Radix keeps focus in the content).
    expect(html.indexOf("Type to filter")).toBeLessThan(html.indexOf("Provider 0"));
  });

  it("labels each group so filtering keeps labels coherent", () => {
    const html = renderToStaticMarkup(<ProviderListBody groups={groups} />);
    expect(html.match(/select-label/g)?.length).toBe(groups.length);
  });
});
