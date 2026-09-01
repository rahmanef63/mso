import { describe, expect, it } from "vitest";
import { MAX_ACTIVE_TOOLS, selectToolsForTurn } from "./mso-agent-tool-router.mjs";

const tool = (name: string, description: string) => ({ name, description, scope: "read", inputSchema: { type: "object", properties: {} } });
const catalog = [
  tool("workflow_start", "Start multi-step workflow"), tool("workflow_status", "Workflow status"),
  tool("workflow_finish", "Finish workflow"), tool("workflow_cancel", "Cancel workflow"),
  tool("skills_search", "Search capabilities skills tools recipes"), tool("projects_list", "List projects repositories"),
  tool("project_capabilities", "Inspect project functions"), tool("agent_session_current", "Current session"),
  tool("sys_stats", "Live VPS CPU memory disk uptime health"), tool("sys_processes", "Top CPU processes"),
  tool("apps_list", "Managed apps hermes openclaw"), tool("apps_logs", "Recent application logs"),
  tool("fs_read", "Read a text file"), tool("fs_write", "Write or update a text file"),
  tool("exec_run", "Run a short shell command"), tool("exec_job_start", "Run long tests and builds"),
  tool("exec_job_status", "Read long job status"), tool("exec_job_cancel", "Cancel long job"),
  tool("screen_capture", "Capture screenshot"), tool("browser_status", "Camoufox browser state"),
  tool("cloudflare_zones_list", "List Cloudflare DNS zones"), tool("hostinger_dns_upsert", "Update Hostinger DNS record"),
];

describe("MSO per-turn tool router", () => {
  it("keeps core discovery while selecting the relevant bounded tools", () => {
    const out = selectToolsForTurn(catalog, [{ role: "user", text: "why is hermes down? inspect its logs" }]);
    expect(out.selectedNames).toContain("skills_search");
    expect(out.selectedNames).toContain("apps_logs");
    expect(out.selectedNames).toContain("apps_list");
    expect(out.activeCount).toBeLessThan(catalog.length);
    expect(out.softLimit).toBe(MAX_ACTIVE_TOOLS);
  });

  it("loads a tool explicitly named by a discovery result on the next turn", () => {
    const history = [
      { role: "user", text: "update DNS" },
      { role: "assistant", toolUses: [{ name: "skills_search", input: {} }] },
      { role: "tool", results: [{ content: "best tool: hostinger_dns_upsert" }] },
    ];
    expect(selectToolsForTurn(catalog, history).selectedNames).toContain("hostinger_dns_upsert");
  });

  it("keeps long-job companions when build work selects exec_job_start", () => {
    const out = selectToolsForTurn(catalog, [{ role: "user", text: "run the full build and test pipeline" }]);
    expect(out.selectedNames).toContain("exec_job_start");
    expect(out.selectedNames).toContain("exec_job_status");
    expect(out.selectedNames).toContain("exec_job_cancel");
  });
});
