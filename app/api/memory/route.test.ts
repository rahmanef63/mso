import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(async () => true),
  listMemories: vi.fn(async () => ["memory-1", "memory-2"]),
  addMemory: vi.fn(async (text: string) => ({ id: "mem-123", text })),
  removeMemory: vi.fn(async () => undefined),
}));

vi.mock("@/lib/auth/require-session", () => ({
  requireSession: mocks.requireSession,
}));

vi.mock("@/lib/agent/legacy-owner-memory", () => ({
  listMemories: mocks.listMemories,
  addMemory: mocks.addMemory,
  removeMemory: mocks.removeMemory,
}));

import { DELETE, GET, POST } from "./route";

const postReq = (body: unknown) =>
  new NextRequest("https://mso.example/api/memory", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const deleteReq = (url: string) =>
  new NextRequest(url, {
    method: "DELETE",
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSession.mockResolvedValue(true);
  mocks.listMemories.mockResolvedValue(["memory-1", "memory-2"]);
  mocks.addMemory.mockImplementation(async (text: string) => ({ id: "mem-123", text }));
  mocks.removeMemory.mockResolvedValue(undefined);
});

describe("/api/memory", () => {
  describe("GET", () => {
    it("returns 401 when unauthenticated", async () => {
      mocks.requireSession.mockResolvedValue(false);
      const res = await GET();
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Unauthorized" });
      expect(mocks.listMemories).not.toHaveBeenCalled();
    });

    it("returns list of memories on success", async () => {
      const res = await GET();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ memories: ["memory-1", "memory-2"] });
      expect(mocks.listMemories).toHaveBeenCalledOnce();
    });
  });

  describe("POST", () => {
    it("returns 401 when unauthenticated", async () => {
      mocks.requireSession.mockResolvedValue(false);
      const res = await POST(postReq({ text: "remember this" }));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Unauthorized" });
      expect(mocks.addMemory).not.toHaveBeenCalled();
    });

    it("returns 400 when body is invalid JSON", async () => {
      const res = await POST(postReq("not valid json {"));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "bad_request" });
      expect(mocks.addMemory).not.toHaveBeenCalled();
    });

    it("returns 400 when text is empty or missing", async () => {
      const emptyRes = await POST(postReq({ text: "" }));
      expect(emptyRes.status).toBe(400);
      expect(await emptyRes.json()).toEqual({ error: "text required" });

      const whitespaceRes = await POST(postReq({ text: "   " }));
      expect(whitespaceRes.status).toBe(400);
      expect(await whitespaceRes.json()).toEqual({ error: "text required" });

      const missingRes = await POST(postReq({}));
      expect(missingRes.status).toBe(400);
      expect(await missingRes.json()).toEqual({ error: "text required" });

      expect(mocks.addMemory).not.toHaveBeenCalled();
    });

    it("adds memory and returns 200 on valid input", async () => {
      const res = await POST(postReq({ text: "prefer dark mode" }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        ok: true,
        memory: { id: "mem-123", text: "prefer dark mode" },
      });
      expect(mocks.addMemory).toHaveBeenCalledWith("prefer dark mode");
    });
  });

  describe("DELETE", () => {
    it("returns 401 when unauthenticated", async () => {
      mocks.requireSession.mockResolvedValue(false);
      const res = await DELETE(deleteReq("https://mso.example/api/memory?id=mem-123"));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Unauthorized" });
      expect(mocks.removeMemory).not.toHaveBeenCalled();
    });

    it("returns 400 when id search param is missing", async () => {
      const res = await DELETE(deleteReq("https://mso.example/api/memory"));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "id required" });
      expect(mocks.removeMemory).not.toHaveBeenCalled();
    });

    it("removes memory and returns 200 on success", async () => {
      const res = await DELETE(deleteReq("https://mso.example/api/memory?id=mem-123"));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(mocks.removeMemory).toHaveBeenCalledWith("mem-123");
    });
  });
});
