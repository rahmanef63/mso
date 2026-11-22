import { describe, expect, it } from "vitest";
import { integrationSetupPage } from "./setup-page";
import { PROVIDER_ICON_ASSETS } from "./provider-icons";

// Regression: the page CSP was `default-src 'none'` with no `img-src`, so every
// official brand mark the provider picker paints with <img> was refused. Dokploy,
// Composio and DOKU rendered as empty tiles, and the refusal surfaced only as a
// console CSP violation the operator could not act on.
describe("integrations page allows the brand marks it renders", () => {
  it("permits self-hosted images", () => {
    for (const embedded of [false, true]) {
      const { csp } = integrationSetupPage(embedded);
      expect(csp).toContain("img-src 'self'");
      expect(csp).toContain("default-src 'none'");
    }
  });

  it("serves the image marks the picker actually references from this origin", () => {
    for (const path of Object.values(PROVIDER_ICON_ASSETS)) {
      expect(path.startsWith("/brand/official/")).toBe(true);
    }
  });
});
