import { describe, expect, it } from "vitest";
import * as compat from "./memory";
import * as workflow from "@/lib/workflow";

describe("legacy skills memory compatibility surface", () => {
  it("re-exports the workflow owner without duplicating implementation", () => {
    expect(compat.startWorkflow).toBe(workflow.startWorkflow);
    expect(compat.finishWorkflow).toBe(workflow.finishWorkflow);
    expect(compat.listLearnedRecipes).toBe(workflow.listLearnedRecipes);
    expect(compat.summarizeWorkflowQuality).toBe(workflow.summarizeWorkflowQuality);
  });
});
