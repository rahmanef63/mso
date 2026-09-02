import { describe, expect, it } from "vitest";
import { LOCAL_AGENT_TOOLS } from "./tools-local-agents";

const local = new Map(LOCAL_AGENT_TOOLS.map((tool) => [tool.name, tool]));

describe("native local session agent MCP tools", () => {
  it("keeps local discovery/inbox read-only and message delivery below exec", () => {
    expect(local.get("local_agents_list")?.scope).toBe("read");
    expect(local.get("local_agent_inbox")?.scope).toBe("read");
    expect(local.get("local_agent_message_send")?.scope).toBe("write");
  });

  it("describes local messaging without Agent Card registration", () => {
    const description = local.get("local_agent_message_send")?.description || "";
    expect(description).toMatch(/same-owner MSO session agent/i);
    expect(description).toMatch(/no hidden transcript/i);
    expect(description).not.toMatch(/Agent Card URL/i);
  });
});
