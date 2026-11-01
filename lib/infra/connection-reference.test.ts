import { describe, expect, it } from "vitest";
import {
  integrationDeepLink,
  integrationReference,
  parseIntegrationReference,
} from "./connection-reference";

// The point of this module is a reference an agent can act on without asking a follow-up question.
// So the tests pin both halves: the exact strings copied out, and the fact that parsing is strict
// enough to refuse anything ambiguous.

describe("integration reference", () => {
  it("builds the paste form from the three identity parts", () => {
    expect(integrationReference({ user: "dita", provider: "convex", connection: "dita-convex" }))
      .toBe("mso-integration:dita/convex/dita-convex");
  });

  it("canonicalises a legacy provider alias, or the reference will not resolve", () => {
    // `convex-cloud` is the legacy id; the catalog resolves it to `convex`. A reference carrying
    // the alias makes `catalog.find(p => p.id === provider)` fail and the UI silently fall back to
    // the first provider in the list.
    expect(integrationReference({ user: "dita", provider: "convex-cloud", connection: "c" }))
      .toBe("mso-integration:dita/convex/c");
  });

  it("builds the clickable form from the same parts", () => {
    expect(integrationDeepLink("https://mso.example.com", { user: "dita", provider: "convex", connection: "dita-convex" }))
      .toBe("https://mso.example.com/integrations?user=dita&provider=convex&connection=dita-convex");
  });

  it("tolerates a trailing slash on the origin instead of emitting a double slash", () => {
    expect(integrationDeepLink("https://mso.example.com/", { user: "u", provider: "p", connection: "c" }))
      .toBe("https://mso.example.com/integrations?user=u&provider=p&connection=c");
  });

  it.each([
    ["token form", "mso-integration:dita/convex/dita-convex"],
    ["bare triple", "dita/convex/dita-convex"],
    ["full URL", "https://mso.example.com/integrations?user=dita&provider=convex&connection=dita-convex"],
    ["URL with extra params", "https://mso.example.com/integrations?transfer=1&user=dita&provider=convex&connection=dita-convex"],
  ])("parses the %s, so people can paste whichever they copied", (_label, input) => {
    expect(parseIntegrationReference(input)).toEqual({ user: "dita", provider: "convex", connection: "dita-convex" });
  });

  it("canonicalises on parse too", () => {
    expect(parseIntegrationReference("mso-integration:dita/convex-cloud/dita-convex"))
      .toEqual({ user: "dita", provider: "convex", connection: "dita-convex" });
  });

  it.each([
    ["empty", ""],
    ["whitespace", "   "],
    ["only two parts", "dita/convex"],
    ["four parts", "a/b/c/d"],
    ["empty segment", "dita//dita-convex"],
    ["URL missing a param", "https://mso.example.com/integrations?user=dita&provider=convex"],
    ["unknown provider", "mso-integration:dita/not-a-provider/dita-convex"],
    ["not a URL at all", "https://"],
  ])("refuses %s", (_label, input) => {
    expect(parseIntegrationReference(input)).toBeNull();
  });

  it("round-trips through both forms", () => {
    const ref = { user: "manef", provider: "convex", connection: "komunitas-tech" };
    expect(parseIntegrationReference(integrationReference(ref))).toEqual(ref);
    expect(parseIntegrationReference(integrationDeepLink("https://x.test", ref))).toEqual(ref);
  });
});
