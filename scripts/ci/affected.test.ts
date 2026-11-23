import { describe, expect, it } from "vitest";
import { DOCS_CONTRACT_TESTS, buildGatePlan, classifyChanges } from "./affected.mjs";
import { RELEASE_E2E_JOURNEYS, selectJourneys } from "../e2e/manifest.mjs";

describe("change-aware modular gate planner", () => {
  it("classifies docs-only edits and runs doc checks + doc contract tests without build/svelte/rust", () => {
    const plan = buildGatePlan(["docs/ARCHITECTURE.md", "README.md"]);
    expect(plan.mode).toBe("docs-only");
    expect(plan.steps.typecheck).toBe(false);
    expect(plan.steps.vitestTargets).toEqual([...DOCS_CONTRACT_TESTS]);
    expect(plan.steps.svelte).toBe(false);
    expect(plan.steps.rust).toBe(false);
    expect(plan.steps.buildAndE2e).toBe(false);
    expect(plan.steps.staticChecks).toEqual(["docs", "comparison", "changelog", "instance-literals"]);
  });

  it("scopes isolated lib domain changes to that domain's tests", () => {
    const plan = buildGatePlan(["lib/workflow/store.ts"]);
    expect(plan.mode).toBe("modular");
    expect(plan.steps.typecheck).toBe(true);
    expect(plan.steps.vitestTargets).toEqual(["lib/workflow"]);
    expect(plan.steps.svelte).toBe(false);
    expect(plan.steps.rust).toBe(false);
  });

  it("isolates rust-shell changes to rust-only workspace tests", () => {
    const plan = buildGatePlan(["rust-shell/crates/mso-shell-core/src/server.rs"]);
    expect(plan.mode).toBe("rust-only");
    expect(plan.steps.rust).toBe(true);
    expect(plan.steps.svelte).toBe(false);
    expect(plan.steps.typecheck).toBe(false);
    expect(plan.steps.vitestTargets).toEqual([]);
    expect(plan.steps.buildAndE2e).toBe(false);
  });

  it("isolates non-shell frontend/svelte changes and records Svelte module slugs", () => {
    const plan = buildGatePlan(["frontend/svelte/src/lib/workflows/WorkflowGraphCanvas.svelte"]);
    expect(plan.mode).toBe("svelte-only");
    expect(plan.classification.slices).toEqual(["workflows"]);
    expect(plan.steps.svelte).toBe(true);
    expect(plan.steps.rust).toBe(false);
    expect(plan.steps.staticChecks).toContain("features");
    expect(plan.steps.buildAndE2e).toBe(false);
  });

  it("escalates core shell Svelte edits to full mode while keeping svelte enabled", () => {
    const plan = buildGatePlan(["frontend/svelte/src/lib/shell/ShellChrome.svelte"]);
    expect(plan.mode).toBe("full");
    expect(plan.classification.core).toBe(true);
    expect(plan.classification.svelte).toBe(true);
    expect(plan.steps.svelte).toBe(true);
  });

  it("marks Svelte dependency changes so svelte:install runs", () => {
    const c = classifyChanges(["frontend/svelte/package.json"]);
    expect(c.svelte).toBe(true);
    expect(c.deps).toBe(true);
  });

  it("escalates core runtime or dependency changes to full verification", () => {
    const plan = buildGatePlan(["lib/http/router.ts"]);
    expect(plan.mode).toBe("full");
    expect(plan.steps.vitestTargets).toBe("all");
    expect(plan.steps.e2eJourneys).toEqual(RELEASE_E2E_JOURNEYS.map((j) => j.id));
    expect(plan.steps.svelte).toBe(false);
    expect(plan.steps.rust).toBe(false);

    const depPlan = buildGatePlan(["package.json"]);
    expect(depPlan.mode).toBe("full");
    expect(depPlan.steps.svelte).toBe(true);
    expect(depPlan.steps.rust).toBe(true);
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
