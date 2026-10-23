import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProviderList } from "./provider-list";
import { ProviderManage } from "./provider-manage";

// Complaint 2: adding a custom provider must be visible, and the collapsed state
// must explain what the affordance does. Complaint 3 needs the connected list to
// say plainly whether a provider has models.
describe("custom provider affordance", () => {
  it("labels the collapsed add-custom-provider control and exposes expand state", () => {
    const html = renderToStaticMarkup(<ProviderManage providers={[]} selected="anthropic" reload={() => {}} />);
    expect(html).toContain("Add custom provider");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="custom-provider-form"');
    expect(html).toContain("Discover to pull in the model ids");
    // Collapsed: the form itself is not mounted until asked for.
    expect(html).not.toContain("Custom endpoint —");
  });
});

describe("connected provider list", () => {
  it("shows a custom provider's model count", () => {
    const html = renderToStaticMarkup(
      <ProviderList
        providers={[{ id: "ai-hub", kind: "custom", hasKey: true, masked: "sk-…", models: ["a", "b"] }]}
        selected="anthropic"
        onChanged={() => {}}
      />,
    );
    expect(html).toContain("2 models");
  });

  it("says a custom provider has no models yet instead of leaving it blank", () => {
    const html = renderToStaticMarkup(
      <ProviderList
        providers={[{ id: "ai-hub", kind: "custom", hasKey: true, masked: "sk-…", models: [] }]}
        selected="ai-hub"
        onChanged={() => {}}
      />,
    );
    expect(html).toContain("no models yet");
    expect(html).toContain("active");
  });

  it("keeps a labelled remove control per provider", () => {
    const html = renderToStaticMarkup(
      <ProviderList
        providers={[{ id: "ai-hub", kind: "custom", hasKey: true, masked: "sk-…" }]}
        selected="ai-hub"
        onChanged={() => {}}
      />,
    );
    expect(html).toContain('aria-label="Remove ai-hub"');
  });
});
