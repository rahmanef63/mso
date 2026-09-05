import { inlineScripts } from "../../scripts/test-support/inline-scripts";
import { expect, it } from "vitest";
import { connectionCatalog } from "./connection-registry";
import { CONNECTION_MANAGER_SCRIPT } from "./connection-ui";
import { INFRA_PROVIDER_IDS } from "./types";
import { integrationSetupPage } from "./setup-page";
it("derives the complete native setup catalog from the same provider registry", () => {
  const rows = connectionCatalog(); expect(rows.map(p => p.id)).toEqual([...INFRA_PROVIDER_IDS]);
  for (const p of rows) for (const source of p.sources) for (const method of source.methods) { expect(method.guidance.url).toMatch(/^https:/); expect(method.guidance.steps.length).toBeGreaterThan(1); }
  expect(rows.find(p => p.id === "composio")?.sources.find(s=>s.id==="direct")?.methods.map(m => m.id)).toEqual(["project", "organization"]);
});
it("keeps guidance before login and preserves explicit role/expiry recovery", () => {
  const page = integrationSetupPage();
  expect(() => new Function(inlineScripts(page.html)[0])).not.toThrow();
  for (const marker of ['"/api/auth/me"', 'owner=auth.role==="owner"', '"visibilitychange"', 'How to get this credential', 'mountConnectionManager']) expect(page.html).toContain(marker);
  expect(CONNECTION_MANAGER_SCRIPT).not.toContain('localStorage'); expect(page.csp).toContain("form-action 'none'");
});
