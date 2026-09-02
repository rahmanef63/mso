import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/a2a/local-session", () => ({
  handoffOwnerLocalSession: vi.fn(async () => ({ session: { id: "target" }, task: { state: "completed" } })),
}));

const { LOCAL_AGENT_TOOLS } = await import("./tools-local-agents");
const local = new Map(LOCAL_AGENT_TOOLS.map((tool) => [tool.name, tool]));

describe("native local session agent MCP tools", () => {
  it("keeps discovery/wait/inbox read-only, mailbox delivery below exec, and fresh-worker request explicit exec", () => {
    expect(local.get("local_agents_list")?.scope).toBe("read");
    expect(local.get("local_agent_inbox")?.scope).toBe("read");
    expect(local.get("local_agent_request_wait")?.scope).toBe("read");
    expect(local.get("local_agent_message_send")?.scope).toBe("write");
    expect(local.get("local_agent_reply")?.scope).toBe("write");
    expect(local.get("local_agent_request")?.scope).toBe("exec");
  });

  it("describes local collaboration without Agent Card registration", () => {
    const description = local.get("local_agent_message_send")?.description || "";
    expect(description).toMatch(/same-owner MSO session agent/i);
    expect(description).toMatch(/no hidden transcript/i);
    expect(description).not.toMatch(/Agent Card URL/i);
    expect(local.get("local_agent_reply")?.description).toMatch(/correlation/i);
    expect(local.get("local_agent_request_wait")?.description).toMatch(/bounded foreground/i);
    expect(local.get("local_agent_request")?.description).toMatch(/fresh bounded worker/i);
    expect(local.get("local_agent_inbox")?.description).toMatch(/bounded interval/i);
    const inboxSchema = JSON.stringify(local.get("local_agent_inbox")?.inputSchema ?? {});
    expect(inboxSchema).toContain('"wait_ms"');
    expect(inboxSchema).toContain('"maximum":20000');
  });
});
