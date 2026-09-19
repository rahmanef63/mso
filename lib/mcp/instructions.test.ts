import { describe, expect, it } from "vitest";
import {
  AGENT_BOOTSTRAP_SKILL,
  AGENT_BOOTSTRAP_STEPS,
  mcpInstructions,
  workflowOrientation,
} from "./instructions";

describe("MSO agent bootstrap instructions", () => {
  it("keeps a stable seven-step first-call sequence", () => {
    expect(AGENT_BOOTSTRAP_SKILL).toBe("mso-agent-bootstrap");
    expect(AGENT_BOOTSTRAP_STEPS.map((step) => step.n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const joined = AGENT_BOOTSTRAP_STEPS.map((step) => `${step.call} ${step.detail}`).join(" ");
    for (const token of [
      "skills_search", "projects_list", "workflow_start", "project_capabilities",
      "project_mcp_tools", "project_mcp_call", "integration_query", "integration_execute",
      "read_pipeline", "exec_run",
    ]) expect(joined).toContain(token);
    expect(joined.toLowerCase()).toContain("never put secrets");
    expect(joined).not.toMatch(/OS_LOGIN_PASSWORD|api[_-]?key\s*=/i);
  });

  it("advertises the sequence at initialize time without promoting write tools on a read token", () => {
    const read = mcpInstructions("read");
    expect(read).toContain(AGENT_BOOTSTRAP_SKILL);
    expect(read).toContain("skills_search");
    expect(read).toContain("read-only");
    expect(read).not.toContain("workflow_start");
    expect(read).not.toContain("workflow_finish");
    expect(read).not.toContain("workflow_cancel");

    const exec = mcpInstructions("exec");
    expect(exec).toContain("workflow_start");
    expect(exec).toContain("workflow_finish");
    expect(exec).toContain("workflow_cancel");
    expect(exec).toContain("read_pipeline");
    expect(mcpInstructions("exec", "chatgpt")).toContain("project_mcp_tools then project_mcp_call");
  });

  it("omits workflow_start from read-scope orientation returned by workflow bootstrap", () => {
    const read = workflowOrientation("read");
    expect(read.skill).toBe(AGENT_BOOTSTRAP_SKILL);
    expect(read.steps.some((step) => step.call.includes("workflow_start"))).toBe(false);
    expect(workflowOrientation("exec").steps.some((step) => step.call.includes("workflow_start"))).toBe(true);
  });
});
