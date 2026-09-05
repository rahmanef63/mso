import { expect, it } from "vitest";
import { setupCatalog, SETUP_HUB_SCRIPT } from "./setup-hub";
import { INFRA_PROVIDER_IDS } from "./types";
import { integrationSetupPage } from "./setup-page";
it("derives the complete native setup catalog from the same provider registry", () => {
  const rows = setupCatalog(); expect(rows.map(p => p.id)).toEqual([...INFRA_PROVIDER_IDS]);
  for (const p of rows) for (const method of p.methods) { expect(method.guidance.url).toMatch(/^https:/); expect(method.guidance.steps.length).toBeGreaterThan(1); }
  expect(rows.find(p => p.id === "composio")?.methods.map(m => m.id)).toEqual(["project", "organization"]);
});
it("public hub is usable before sign-in and offers explicit auth/expiry recovery", () => {
  const page = integrationSetupPage();
  expect(() => new Function(page.html.match(/<script[^>]*>([\s\S]*?)<\/script>/)![1])).not.toThrow();
  for (const marker of ['"/api/auth/me"', 'start.disabled=userState.role!=="owner"', '"visibilitychange"', '"How to get this credential"', '"Open a new setup session"']) expect(page.html).toContain(marker);
  expect(SETUP_HUB_SCRIPT).not.toContain('localStorage'); expect(page.csp).toContain("form-action 'none'");
});
