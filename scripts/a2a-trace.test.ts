// @ts-nocheck
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

describe("A2A workflow trace bridge", () => {
  let stateDir;
  let mod;
  const requests = [];

  beforeAll(async () => {
    stateDir = await mkdtemp(path.join(os.tmpdir(), "mso-a2a-trace-"));
    process.env.MSO_A2A_TRACE_STATE_DIR = stateDir;
    process.env.MSO_AGENT_BASE = "http://127.0.0.1:4005";
    process.env.MSO_AGENT_ORIGIN = "http://127.0.0.1:4005";
    process.env.MSO_AGENT_JAR = "";
    vi.stubGlobal("fetch", vi.fn(async (url, init = {}) => {
      const body = init.body ? JSON.parse(String(init.body)) : null;
      requests.push({ url: String(url), body });
      if (String(url).endsWith("/api/v1/agent-sessions")) {
        return new Response(JSON.stringify({
          session: { id: "session-1", name: "trace-agent", label: "trace-agent-project" }
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (String(url).endsWith("/api/v1/agent-tools")) {
        const name = body && body.name;
        let result = { ok: true };
        if (name === "workflow_start") result = { workflowId: "workflow-1", bootstrap: { orchestration: { workspacePath: "/tmp/worktree" } } };
        if (name === "workflow_status") result = { active: true, workflowId: "workflow-1", stepCount: 1, steps: [] };
        if (name === "agent_session_flow") result = { session: { label: "trace-agent-project" }, steps: [{ ref: "S1", title: "Implement" }] };
        if (name === "workflow_finish") result = { workflow: { id: "workflow-1" }, evidence: { valid: true } };
        return new Response(JSON.stringify({ ok: true, result: JSON.stringify(result) }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ error: "unexpected route" }), { status: 404 });
    }));
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    mod = await import("./a2a-trace.mjs");
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    delete process.env.MSO_A2A_TRACE_STATE_DIR;
    await rm(stateDir, { recursive: true, force: true });
  });

  it("creates one durable session/workflow and correlates safe progress + finish", async () => {
    await mod.main(["start", "--intent", "Implement A2A trace", "--project", "mso", "--agent", "codex", "--run", "a2a-test"]);
    await mod.main(["progress", "--run", "a2a-test", "--stage", "implement", "--message", "Bounded implementation complete"]);
    await mod.main(["status", "--run", "a2a-test"]);
    await mod.main(["context", "--run", "a2a-test"]);
    await mod.main(["finish", "--run", "a2a-test", "--summary", "Implemented and verified", "--evidence", "{\"tests\":[\"targeted test passed\"]}"]);

    const toolBodies = requests.filter((row) => row.body && row.body.name).map((row) => row.body);
    expect(toolBodies.map((row) => row.name)).toEqual([
      "workflow_start",
      "agent_session_note",
      "workflow_status",
      "agent_session_flow",
      "workflow_finish"
    ]);
    const note = toolBodies.find((row) => row.name === "agent_session_note");
    expect(note.input.workflow_id).toBe("workflow-1");
    expect(note.input.note).toContain("[A2A:codex] progress/implement");
    expect(note.approvalDigest).toMatch(/^[a-f0-9]{64}$/);

    const finish = toolBodies.find((row) => row.name === "workflow_finish");
    expect(finish.input.workflow_id).toBe("workflow-1");
    expect(finish.input.evidence.tests).toEqual(["targeted test passed"]);

    const file = path.join(stateDir, "a2a-test.json");
    expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({
      runId: "a2a-test",
      sessionId: "session-1",
      workflowId: "workflow-1",
      status: "finished"
    });
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it("rejects malformed remote state and never follows a swapped state-file symlink", async () => {
    const support = await import("./a2a-trace-support.mjs");
    const state = JSON.parse(await readFile(path.join(stateDir, "a2a-test.json"), "utf8"));
    await expect(support.saveState({ ...state, sessionId: { command: "malicious" } })).rejects.toThrow("invalid A2A trace");
    await expect(support.saveState({ ...state, sessionLabel: "x".repeat(121) })).rejects.toThrow("invalid A2A trace field");
    await expect(support.saveState({ ...state, executable: "malicious" })).rejects.toThrow("invalid A2A trace field");
    const target = path.join(stateDir, "outside.json");
    await writeFile(target, JSON.stringify(state));
    await symlink(target, path.join(stateDir, "a2a-link.json"));
    await expect(support.readState("a2a-link")).rejects.toMatchObject({ code: "ELOOP" });
    await writeFile(path.join(stateDir, "a2a-huge.json"), "x".repeat(8193));
    await expect(support.readState("a2a-huge")).rejects.toThrow("invalid A2A trace state file");
  });

  it("does not expose hidden reasoning as a trace event type", async () => {
    await expect(mod.main(["reasoning", "--run", "a2a-test", "--message", "private thoughts"])).rejects.toThrow("unknown A2A trace command");
  });
});
