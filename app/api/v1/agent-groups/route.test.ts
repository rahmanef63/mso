import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionContext: vi.fn(),
  agentGroupsSnapshot: vi.fn(async (): Promise<{ groups: unknown[] }> => ({ groups: [] })),
  getAgentGroup: vi.fn(async (_id?: string): Promise<unknown> => undefined),
  createAgentGroup: vi.fn(async (_data?: unknown): Promise<{ result: unknown }> => ({ result: {} })),
  updateAgentGroup: vi.fn(),
  deleteAgentGroup: vi.fn(),
  startAgentGroupRun: vi.fn(),
  stopAgentGroupRun: vi.fn(),
}));

vi.mock("@/lib/auth/require-session", () => ({
  getSessionContext: mocks.getSessionContext,
}));

vi.mock("@/lib/agent-group", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent-group")>();
  return {
    ...actual,
    agentGroupsSnapshot: mocks.agentGroupsSnapshot,
    getAgentGroup: mocks.getAgentGroup,
    createAgentGroup: mocks.createAgentGroup,
    updateAgentGroup: mocks.updateAgentGroup,
    deleteAgentGroup: mocks.deleteAgentGroup,
    startAgentGroupRun: mocks.startAgentGroupRun,
    stopAgentGroupRun: mocks.stopAgentGroupRun,
  };
});

import { AgentGroupError } from "@/lib/agent-group";
import { GET, POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSessionContext.mockResolvedValue({
    role: "owner",
    session: { device_id: "dev-owner-1" },
  });
  mocks.agentGroupsSnapshot.mockResolvedValue({ groups: [{ id: "g1", name: "Alpha" }] });
  mocks.getAgentGroup.mockResolvedValue({ id: "g1", name: "Alpha" });
  mocks.createAgentGroup.mockResolvedValue({ result: { id: "g2", name: "Beta" } });
});

describe("agent-groups route contract", () => {
  describe("GET /api/v1/agent-groups", () => {
    // agent-groups rejects non-owners with 403 { error: "owner_required" }
    it("returns 403 { error: 'owner_required' } when session is missing", async () => {
      mocks.getSessionContext.mockResolvedValue(null);

      const res = await GET(new Request("https://mso.example/api/v1/agent-groups"));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "owner_required" });
      expect(mocks.agentGroupsSnapshot).not.toHaveBeenCalled();
    });

    it("returns 403 { error: 'owner_required' } when caller role is not owner", async () => {
      mocks.getSessionContext.mockResolvedValue({
        role: "viewer",
        session: { device_id: "dev-viewer-1" },
      });

      const res = await GET(new Request("https://mso.example/api/v1/agent-groups"));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "owner_required" });
      expect(mocks.agentGroupsSnapshot).not.toHaveBeenCalled();
    });

    it("returns 200 with snapshot when no id parameter given", async () => {
      const res = await GET(new Request("https://mso.example/api/v1/agent-groups"));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ groups: [{ id: "g1", name: "Alpha" }] });
      expect(mocks.agentGroupsSnapshot).toHaveBeenCalledTimes(1);
    });

    it("returns 200 with specific group when id parameter is present", async () => {
      const res = await GET(new Request("https://mso.example/api/v1/agent-groups?id=g1"));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ id: "g1", name: "Alpha" });
      expect(mocks.getAgentGroup).toHaveBeenCalledWith("g1");
    });

    it("maps AgentGroupError to status code and error code", async () => {
      mocks.getAgentGroup.mockRejectedValue(new AgentGroupError("agent_group_not_found", 404));

      const res = await GET(new Request("https://mso.example/api/v1/agent-groups?id=missing"));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "agent_group_not_found" });
    });
  });

  describe("POST /api/v1/agent-groups", () => {
    it("returns 403 { error: 'owner_required' } when unauthenticated", async () => {
      mocks.getSessionContext.mockResolvedValue(null);

      const res = await POST(
        new Request("https://mso.example/api/v1/agent-groups", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "create", data: { name: "New Group" } }),
        }),
      );
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "owner_required" });
      expect(mocks.createAgentGroup).not.toHaveBeenCalled();
    });

    it("executes valid action when owner", async () => {
      const res = await POST(
        new Request("https://mso.example/api/v1/agent-groups", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "create", data: { name: "New Group" } }),
        }),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ id: "g2", name: "Beta" });
      expect(mocks.createAgentGroup).toHaveBeenCalledWith({ name: "New Group" });
    });

    it("returns 400 for unknown action", async () => {
      const res = await POST(
        new Request("https://mso.example/api/v1/agent-groups", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "unsupported" }),
        }),
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "unknown_group_action" });
    });
  });
});
