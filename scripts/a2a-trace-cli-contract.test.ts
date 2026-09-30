import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const commands = readFileSync(path.join(root, "scripts/cli/commands-state.sh"), "utf8");
const usage = readFileSync(path.join(root, "scripts/cli/commands.sh"), "utf8");
const bridge = ["scripts/a2a-trace.mjs", "scripts/a2a-trace-support.mjs"].map((file) => readFileSync(path.join(root, file), "utf8")).join("\n");
const skill = readFileSync(path.join(root, "claude-skills/a2a/SKILL.md"), "utf8");

describe("A2A trace CLI + skill contract", () => {
  it("wires mso a2a trace through the normal authenticated agent-tool route", () => {
    expect(usage).toContain("trace <start|progress|plan|action|evidence|blocker|result|handoff|status|context|attach|finish|cancel|list>");
    expect(commands).toContain('jget "/api/v1/agent-tools" >/dev/null');
    expect(commands).toContain('node "$ROOT/scripts/a2a-trace.mjs" "$@"');
    expect(commands).toContain('MSO_AGENT_JAR="$JAR"');
  });

  it("uses durable workflow/session tools rather than bypassing A2A isolation", () => {
    for (const name of ["workflow_start", "agent_session_note", "workflow_status", "agent_session_flow", "workflow_finish", "workflow_cancel"]) {
      expect(bridge).toContain('"' + name + '"');
    }
    expect(bridge).not.toContain('"agent_memory_remember"');
    expect(bridge).not.toContain('"a2a_message_send"');
  });

  it("defines safe progress summaries, not private chain-of-thought streaming", () => {
    expect(bridge).toContain('["plan", "progress", "action", "evidence", "blocker", "result", "handoff"]');
    expect(skill).toContain("observable progress, not private reasoning");
    expect(skill).toContain("Never send chain-of-thought");
    expect(skill).not.toContain("`reasoning` —");
  });
});
