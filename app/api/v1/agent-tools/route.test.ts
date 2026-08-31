import { beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalAgentApproval } from "@/lib/agent/approval.js";

const contextRef: { current: null | { role: string; session: { device_id: string } } } = {
  current: { role: "owner", session: { device_id: "dev-owner" } },
};
const dispatchMock = vi.fn();

vi.mock("@/lib/auth/require-session", () => ({
  getSessionContext: vi.fn(async () => contextRef.current),
}));
vi.mock("@/lib/mcp/dispatch", () => ({
  dispatch: (...args: unknown[]) => dispatchMock(...args),
}));
vi.mock("@/lib/mcp/scope", () => ({
  maxScope: () => "exec",
  allows: (held: string, needed: string) => {
    const rank: Record<string, number> = { read: 0, write: 1, exec: 2 };
    return (rank[held] ?? -1) >= (rank[needed] ?? 99);
  },
}));
vi.mock("@/lib/mcp/tools", () => ({
  TOOLS: [
    { name: "read_tool", scope: "read" },
    { name: "write_tool", scope: "write" },
  ],
}));

const postReq = (body: unknown) => new Request("http://localhost/api/v1/agent-tools", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
}) as never;

describe("/api/v1/agent-tools", () => {
  beforeEach(() => {
    contextRef.current = { role: "owner", session: { device_id: "dev-owner" } };
    dispatchMock.mockReset();
    dispatchMock.mockResolvedValue({
      result: {
        tools: [
          { name: "read_tool", description: "read", inputSchema: { type: "object", properties: {} } },
          { name: "write_tool", description: "write", inputSchema: { type: "object", properties: {} } },
        ],
        _meta: { version: "test" },
      },
    });
  });

  it("requires an owner session even for tool discovery", async () => {
    contextRef.current = { role: "operator", session: { device_id: "dev-op" } };
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(403);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("returns the canonical MCP list with explicit scope and approval metadata", async () => {
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scope).toBe("exec");
    expect(body.tools).toEqual([
      expect.objectContaining({ name: "read_tool", scope: "read", approvalRequired: false }),
      expect.objectContaining({ name: "write_tool", scope: "write", approvalRequired: true }),
    ]);
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({ method: "tools/list" }),
      "exec",
      "cli:dev-owner",
    );
  });

  it("refuses a mutation unless the terminal explicitly approved it", async () => {
    const { POST } = await import("./route");
    const res = await POST(postReq({ name: "write_tool", input: { name: "x" } }));
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: "explicit_agent_approval_required", scope: "write" });
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("binds approval to the exact canonical mutation payload", async () => {
    const { POST } = await import("./route");
    const approved = canonicalAgentApproval("write_tool", { name: "x", nested: { safe: true } });
    const res = await POST(postReq({
      name: "write_tool",
      input: { name: "x", nested: { safe: false } },
      approved: true,
      approvalDigest: approved.digest,
    }));
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: "agent_approval_payload_mismatch", scope: "write" });
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("dispatches an approved mutation with the same owner-device actor", async () => {
    dispatchMock.mockResolvedValueOnce({ result: { content: [{ type: "text", text: "done" }] } });
    const input = { name: "x" };
    const approvalDigest = canonicalAgentApproval("write_tool", input).digest;
    const { POST } = await import("./route");
    const res = await POST(postReq({ name: "write_tool", input, approved: true, approvalDigest }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, result: "done" });
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({ method: "tools/call", params: { name: "write_tool", arguments: { name: "x" } } }),
      "exec",
      "cli:dev-owner",
    );
  });
});
