import { describe, expect, it } from "vitest";
import { buildGatePlan, classifyChanges } from "./affected.mjs";
import { RELEASE_E2E_JOURNEYS, selectJourneys } from "../e2e/manifest.mjs";

describe("change-aware modular gate planner", () => {
  it("classifies docs-only edits and skips typecheck, tests, svelte, and build", () => {
    const plan = buildGatePlan(["docs/ARCHITECTURE.md", "README.md"]);
    expect(plan.mode).toBe("docs-only");
    expect(plan.steps.typecheck).toBe(false);
    expect(plan.steps.vitestTargets).toEqual([]);
    expect(plan.steps.svelte).toBe(false);
    expect(plan.steps.buildAndE2e).toBe(false);
    expect(plan.steps.staticChecks).toContain("docs");
  });

  it("scopes isolated lib domain changes to that domain's tests", () => {
    const plan = buildGatePlan(["lib/workflow/store.ts"]);
    expect(plan.mode).toBe("modular");
    expect(plan.steps.typecheck).toBe(true);
    expect(plan.steps.vitestTargets).toEqual(["lib/workflow"]);
    expect(plan.steps.svelte).toBe(false);
  });

  it("isolates frontend/svelte changes so full backend Vitest is skipped", () => {
    const plan = buildGatePlan(["frontend/svelte/src/routes/+page.svelte"]);
    expect(plan.mode).toBe("svelte-only");
    expect(plan.steps.svelte).toBe(true);
    expect(plan.steps.buildAndE2e).toBe(false);
  });

  it("escalates core runtime or dependency changes to full verification", () => {
    const plan = buildGatePlan(["lib/http/router.ts"]);
    expect(plan.mode).toBe("full");
    expect(plan.steps.vitestTargets).toBe("all");
    expect(plan.steps.e2eJourneys).toEqual(RELEASE_E2E_JOURNEYS.map((j) => j.id));
    expect(plan.steps.svelte).toBe(false);

    const depPlan = buildGatePlan(["package.json"]);
    expect(depPlan.mode).toBe("full");
    expect(depPlan.steps.svelte).toBe(true);
  });

  it("falls back to shell-status smoke when an isolated slice has no dedicated E2E journey", () => {
    expect(selectJourneys({ core: false, slices: ["bot-desktops"] })).toEqual(["shell-status"]);
  });

  it("handles empty file lists conservatively by defaulting to full", () => {
    const c = classifyChanges([]);
    expect(c.docsOnly).toBe(false);
    expect(buildGatePlan([]).mode).toBe("full");
  });
});
