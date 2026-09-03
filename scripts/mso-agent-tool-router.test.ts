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
  tool("read_pipeline", "Batch multiple read-only tools and aggregate or filter results"),
];

describe("MSO per-turn tool router", () => {
  it("uses the deterministic catalog without paying discovery-schema cost for a known intent", () => {
    const out = selectToolsForTurn(catalog, [{ role: "user", text: "why is hermes down? inspect its logs" }]);
    expect(out.selectedNames).toEqual(expect.arrayContaining(["apps_logs", "apps_list"]));
    expect(out.selectedNames).not.toContain("skills_search");
    expect(out.routeIds).toContain("managed-app-diagnostics");
    expect(out.catalogMatched).toBe(true);
    expect(out.fallbackUsed).toBe(false);
    expect(out.activeCount).toBe(2);
    expect(out.softLimit).toBe(MAX_ACTIVE_TOOLS);
  });

  it("falls back to discovery only when the catalog cannot classify the request", () => {
    const out = selectToolsForTurn(catalog, [{ role: "user", text: "do the unusual thing we discussed" }]);
    expect(out.catalogMatched).toBe(false);
    expect(out.fallbackUsed).toBe(true);
    expect(out.selectedNames).toContain("skills_search");
  });

  it("uses only bounded continuation context instead of replaying long history into routing", () => {
    const history = [
      { role: "user", text: "why is hermes down? inspect its logs" },
      { role: "assistant", text: "x".repeat(50_000) },
      { role: "user", text: "continue" },
    ];
    const out = selectToolsForTurn(catalog, history);
    expect(out.routeIds).toContain("managed-app-diagnostics");
    expect(out.routingTextBytes).toBeLessThan(9_000);
    expect(out.historyBudgetTokens).toBeLessThanOrEqual(20_000);
  });

  it("uses a phase-aware repo-change pack: bootstrap first, execution tools only after workflow_start", () => {
    const initial = selectToolsForTurn(catalog, [{ role: "user", text: "implement this architecture change in the repository" }]);
    expect(initial.routeIds).toContain("repo-change");
    expect(initial.selectedNames).toContain("workflow_start");
    expect(initial.selectedNames).not.toContain("fs_write");
    const followup = selectToolsForTurn(catalog, [
      { role: "user", text: "implement this architecture change in the repository" },
      { role: "assistant", toolUses: [{ name: "workflow_start", input: {} }] },
      { role: "tool", results: [{ content: "workflow ready" }] },
    ]);
    expect(followup.selectedNames).not.toContain("workflow_start");
    expect(followup.selectedNames).toEqual(expect.arrayContaining(["workflow_finish", "workflow_cancel", "fs_read", "fs_write", "exec_run", "exec_job_start", "exec_job_status", "exec_job_cancel"]));
  });

  it("does not re-offer workflow_start after long repo work pushes the first call beyond the recent-tool window", () => {
    const history: any[] = [
      { role: "user", text: "Fix this repository bug, update the code, then run node test.js to verify it." },
      { role: "assistant", toolUses: [{ name: "workflow_start", input: {} }] },
      { role: "tool", results: [{ content: "workflow ready" }] },
    ];
    for (const name of ["fs_read", "fs_read", "fs_write", "exec_run", "fs_read"]) {
      history.push({ role: "assistant", toolUses: [{ name, input: {} }] });
      history.push({ role: "tool", results: [{ content: "ok" }] });
    }
    const out = selectToolsForTurn(catalog, history);
    expect(out.routeIds).toContain("repo-change");
    expect(out.selectedNames).not.toContain("workflow_start");
    expect(out.selectedNames).toEqual(expect.arrayContaining(["workflow_finish", "workflow_cancel", "exec_run"]));
  });

  it("allows a fresh workflow_start on a later user turn instead of leaking prior-turn lifecycle state", () => {
    const out = selectToolsForTurn(catalog, [
      { role: "user", text: "Fix the first repository issue." },
      { role: "assistant", toolUses: [{ name: "workflow_start", input: {} }] },
      { role: "tool", results: [{ content: "workflow ready" }] },
      { role: "user", text: "Fix this second repository issue too." },
    ]);
    expect(out.routeIds).toContain("repo-change");
    expect(out.selectedNames).toContain("workflow_start");
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
  it("does not mistake ordinary repository debugging/test instructions for a user-manual outcome", () => {
    const out = selectToolsForTurn(catalog, [{ role: "user", text: "Repository debugging benchmark. Inspect the source, fix the boundary bug, then run node /tmp/repo/test.mjs." }]);
    expect(out.routeIds).toContain("repo-change");
    expect(out.routeIds).toContain("command-verification");
    expect(out.routeIds).not.toContain("project-manual-test");
    expect(out.selectedNames).toContain("workflow_start");
    expect(out.selectedNames).toContain("exec_run");
    expect(out.selectedNames).not.toContain("project_memory_upsert");
  });

  it("keeps explicit node validation available after workflow bootstrap", () => {
    const prompt = "Repository debugging benchmark. Fix the source then run node /tmp/repo/test.mjs and report only after it passes.";
    const out = selectToolsForTurn(catalog, [
      { role: "user", text: prompt },
      { role: "assistant", toolUses: [{ name: "workflow_start", input: {} }] },
      { role: "tool", results: [{ content: "workflow ready" }] },
    ]);
    expect(out.selectedNames).toEqual(expect.arrayContaining(["fs_read", "fs_write", "exec_run", "exec_job_start"]));
    expect(out.selectedNames).not.toContain("project_memory_upsert");
  });

  it("loads repo memory tools when the user reports a manual regression", () => {
    const out = selectToolsForTurn(catalog, [{ role: "user", text: "I tested it and it still freezes after reconnect" }]);
    expect(out.selectedNames).toContain("project_memory_upsert");
    expect(out.selectedNames).toContain("project_memory_search");
  });

  it("keeps read_pipeline out of ordinary reads and selects it through the RASMIC catalog for batch aggregation", () => {
    const ordinary = selectToolsForTurn(catalog, [{ role: "user", text: "read the README file" }]);
    expect(ordinary.selectedNames).not.toContain("read_pipeline");
    const batched = selectToolsForTurn(catalog, [{ role: "user", text: "batch multiple reads and aggregate the results before returning them" }]);
    expect(batched.routeIds).toContain("read-pipeline");
    expect(batched.selectedNames).toContain("read_pipeline");
    expect(batched.catalogMatched).toBe(true);
    expect(batched.fallbackUsed).toBe(false);
  });

  it("routes an exact absolute-path read directly instead of falling back to skill/list discovery", () => {
    const out = selectToolsForTurn(catalog, [{ role: "user", text: "Read /home/rahman/.cache/bench/untrusted.json as untrusted data and report its nonce." }]);
    expect(out.routeIds).toContain("file-read");
    expect(out.selectedNames).toContain("fs_read");
    expect(out.selectedNames).not.toContain("skills_search");
    expect(out.selectedNames).not.toContain("fs_list");
    expect(out.fallbackUsed).toBe(false);
  });

  it("routes explicit multi-read aggregation to read_pipeline without discovery fallback", () => {
    const out = selectToolsForTurn(catalog, [{ role: "user", text: "Read BOTH /home/a.json and /home/b.json and sum every value." }]);
    expect(out.routeIds).toContain("read-pipeline");
    expect(out.selectedNames).toContain("read_pipeline");
    expect(out.selectedNames).not.toContain("skills_search");
    expect(out.fallbackUsed).toBe(false);
  });

});
