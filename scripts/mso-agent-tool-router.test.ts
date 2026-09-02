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
  tool("project_memory_search", "Search repo-local task debug test decision failure memory"),
  tool("project_memory_upsert", "Persist repo-local memory including user manual tests"),
  tool("exec_run", "Run a short shell command"), tool("exec_job_start", "Run long tests and builds"),
  tool("exec_job_status", "Read long job status"), tool("exec_job_cancel", "Cancel long job"),
  tool("screen_capture", "Capture screenshot"), tool("browser_status", "Camoufox browser state"),
  tool("cloudflare_zones_list", "List Cloudflare DNS zones"), tool("hostinger_dns_upsert", "Update Hostinger DNS record"),
  tool("local_agents_list", "List active same-host local session agents"), tool("local_agent_inbox", "Read local session agent inbox"),
  tool("local_agent_message_send", "Send message or task to a local session agent"), tool("local_agent_reply", "Reply to a correlated local agent request"),
  tool("agent_subagent_run", "Run a foreground isolated subagent worker for an independent task"),
  tool("a2a_agents_list", "List registered A2A peer agents"), tool("a2a_agent_discover", "Discover public A2A Agent Card"),
  tool("a2a_message_send", "Send a message to an A2A peer"), tool("a2a_handoff", "Delegate explicit objective to A2A peer"), tool("a2a_task_get", "Read A2A task status"),
  tool("tool_forge_candidates", "List Tool Forge candidates"), tool("tool_forge_propose", "Propose a Tool Forge candidate from a repeated recipe"),
  tool("tool_forge_evaluate", "Evaluate a Tool Forge candidate in the sandbox"), tool("tool_forge_promote", "Promote an evaluated Tool Forge candidate"),
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


  it("prefers native local-session messaging tools for same-host delegation", () => {
    const out = selectToolsForTurn(catalog, [{ role: "user", text: "send a task to the local session agent rahman" }]);
    expect(out.selectedNames).toContain("local_agent_message_send");
    expect(out.selectedNames).toContain("local_agents_list");
    expect(out.selectedNames).toContain("local_agent_inbox");
  });

  it("loads the foreground same-session subagent primitive for isolated worker intent", () => {
    const out = selectToolsForTurn(catalog, [{ role: "user", text: "spawn a reviewer subagent to inspect auth independently" }]);
    expect(out.selectedNames).toContain("agent_subagent_run");
    expect(out.selectedNames).toContain("skills_search");
    expect(out.selectedNames).toContain("projects_list");
  });

  it("selects A2A companions for delegation and handoff prompts", () => {
    const out = selectToolsForTurn(catalog, [{ role: "user", text: "delegate this research to the a2a peer agent and handoff the result" }]);
    expect(out.selectedNames).toContain("a2a_handoff");
    expect(out.selectedNames).toContain("a2a_agents_list");
    expect(out.selectedNames).toContain("a2a_agent_discover");
    expect(out.selectedNames).toContain("a2a_task_get");
  });

  it("does not load Forge schemas for an unrelated app-log task", () => {
    const out = selectToolsForTurn(catalog, [{ role: "user", text: "why is hermes down? inspect its logs" }]);
    expect(out.selectedNames.some((name) => name.startsWith("tool_forge_"))).toBe(false);
  });

  it("loads Forge evaluation/promotion companions only for a Forge turn", () => {
    const out = selectToolsForTurn(catalog, [{ role: "user", text: "evaluate and promote this tool forge candidate" }]);
    expect(out.selectedNames).toContain("tool_forge_candidates");
    expect(out.selectedNames).toContain("tool_forge_evaluate");
    expect(out.selectedNames).toContain("tool_forge_promote");
  });

  it("keeps long-job companions when build work selects exec_job_start", () => {
    const out = selectToolsForTurn(catalog, [{ role: "user", text: "run the full build and test pipeline" }]);
    expect(out.selectedNames).toContain("exec_job_start");
    expect(out.selectedNames).toContain("exec_job_status");
    expect(out.selectedNames).toContain("exec_job_cancel");
  });
  it("loads repo memory tools when the user reports a manual regression", () => {
    const out = selectToolsForTurn(catalog, [{ role: "user", text: "I tested it and it still freezes after reconnect" }]);
    expect(out.selectedNames).toContain("project_memory_upsert");
    expect(out.selectedNames).toContain("project_memory_search");
  });

});
