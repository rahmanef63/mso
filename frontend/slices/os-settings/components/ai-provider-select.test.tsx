import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PROVIDER_LIST_CONTENT_CLASS,
  PROVIDER_LIST_MAX_HEIGHT_REM,
} from "./provider-filter-list";
import { providerGroups } from "./ai-provider-select";
import type { ProviderSummary } from "./ai-provider-options";
import type { ConnectedProvider } from "./provider-list";

const src = (path: string) => readFileSync(path, "utf8");

// Both places that render a provider list must behave the same: one shared,
// explicitly capped content. Duplicated markup drifted before; this locks it.
describe("provider list call sites", () => {
  it("renders the Settings list through the shared bounded component", () => {
    expect(src("frontend/slices/os-settings/components/ai-provider-select.tsx")).toContain("ProviderSelectContent");
  });

  it("renders the Alfa cockpit provider list through the same component", () => {
    expect(src("frontend/slices/assistant/components/model-quick-control.tsx")).toContain("ProviderSelectContent");
  });

  it("never leaves a viewport-derived max height in either call site", () => {
    for (const path of [
      "frontend/slices/os-settings/components/ai-provider-select.tsx",
      "frontend/slices/assistant/components/model-quick-control.tsx",
      "frontend/slices/os-settings/components/provider-filter-list.tsx",
    ]) {
      expect(src(path)).not.toContain("max-h-(--radix-select-content-available-height)");
    }
    expect(PROVIDER_LIST_CONTENT_CLASS).toContain(`max-h-[${PROVIDER_LIST_MAX_HEIGHT_REM}rem]`);
  });

  it("keeps the three Settings groups in order", () => {
    const options: ProviderSummary[] = [
      { id: "free", name: "Free", catalogId: "free", modelCount: 2, freeModelCount: 1, freeAgentModelCount: 1, recommendedFreeModel: "f" },
      { id: "paid", name: "Paid", catalogId: "paid", modelCount: 2, freeModelCount: 0, freeAgentModelCount: 0, recommendedFreeModel: null },
    ];
    const connected: ConnectedProvider[] = [{ id: "ai-hub", kind: "custom", hasKey: true, masked: "sk-…" }];
    const groups = providerGroups(options, connected);
    expect(groups.map((group) => group.label)).toEqual(["Free AI available", "Other providers", "Connected"]);
    expect(groups[0].rows[0].text).toContain("1 free agent-ready");
    expect(groups[2].rows[0].text).toBe("ai-hub (Custom)");
  });

  it("omits a group that has no members instead of rendering an empty label", () => {
    const groups = providerGroups([], [{ id: "codex", kind: "oauth", hasKey: true, masked: "signed in" }]);
    expect(groups.map((group) => group.label)).toEqual(["Connected"]);
    expect(groups[0].rows[0].text).toBe("codex (OAuth)");
  });
});
