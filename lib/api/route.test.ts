import { describe, it, expect, vi, beforeEach } from "vitest";
import { json, readJson, toResponse, guarded, requireSession, requireOwner } from "./route";
import { HostError } from "@/lib/host/host-error";
import type { SessionContext } from "@/lib/auth/require-session";

const mockAuth = vi.hoisted(() => ({
  context: null as SessionContext | null,
}));

vi.mock("@/lib/auth/require-session", () => ({
  getSessionContext: vi.fn(async () => mockAuth.context),
}));

describe("lib/api/route", () => {
  beforeEach(() => {
    mockAuth.context = null;
    vi.clearAllMocks();
  });

  describe("json", () => {
    it("sets content-type application/json and default status 200", async () => {
      const res = json({ hello: "world" });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/json");
      expect(await res.json()).toEqual({ hello: "world" });
    });

    it("accepts a numeric status code", async () => {
      const res = json({ error: "not found" }, 404);
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toBe("application/json");
      expect(await res.json()).toEqual({ error: "not found" });
    });

    it("preserves custom headers while maintaining application/json", async () => {
      const res = json({ ok: true }, {
        status: 201,
        headers: { "x-custom-header": "test-val", "Cache-Control": "no-store" },
      });
      expect(res.status).toBe(201);
      expect(res.headers.get("content-type")).toBe("application/json");
      expect(res.headers.get("x-custom-header")).toBe("test-val");
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(await res.json()).toEqual({ ok: true });
    });

    it("serializes null and undefined safely", async () => {
      const nullRes = json(null);
      expect(await nullRes.json()).toBeNull();

      const undefRes = json(undefined);
      expect(await undefRes.json()).toBeNull();
    });
  });

  describe("readJson", () => {
    it("parses valid JSON payloads", async () => {
      const req = new Request("http://localhost/test", {
        method: "POST",
        body: JSON.stringify({ key: "val" }),
        headers: { "content-type": "application/json" },
      });
      const data = (await readJson(req)) as { key: string };
      expect(data).toEqual({ key: "val" });
    });

    it("returns null on malformed json without throwing", async () => {
      const req = new Request("http://localhost/test", {
        method: "POST",
        body: "{ broken json",
      });
      expect(await readJson(req)).toBeNull();
    });

    it("returns null on empty body without throwing", async () => {
      const req = new Request("http://localhost/test", {
        method: "POST",
      });
      expect(await readJson(req)).toBeNull();
    });
  });

  describe("toResponse", () => {
    it("passes Response instances through unchanged", () => {
      const res = new Response("ok", { status: 200 });
      expect(toResponse(res)).toBe(res);
    });

    it("converts ApiResult object into Response", async () => {
      const res = toResponse({ json: { a: 1 }, status: 202 });
      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ a: 1 });
    });
  });

  describe("requireOwner and requireSession", () => {
    it("returns 401 when no session exists", async () => {
      mockAuth.context = null;
      const res = await requireOwner();
      expect(res).toBeInstanceOf(Response);
      if (res instanceof Response) {
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: "unauthorized" });
      }
    });

    it("returns 401 when session has no device_id", async () => {
      mockAuth.context = {
        session: { device_id: "" } as never,
        device: { label: "d", approvedAt: 1, role: "owner" },
        role: "owner",
      };
      const res = await requireOwner();
      expect(res).toBeInstanceOf(Response);
      if (res instanceof Response) {
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: "unauthorized" });
      }
    });

    it("returns 403 owner_required when user is viewer or operator", async () => {
      mockAuth.context = {
        session: { device_id: "dev-1" } as never,
        device: { label: "d", approvedAt: 1, role: "operator" },
        role: "operator",
      };
      const res = await requireOwner();
      expect(res).toBeInstanceOf(Response);
      if (res instanceof Response) {
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: "owner_required" });
      }
    });

    it("attaches custom headers to 401 and 403 responses", async () => {
      mockAuth.context = null;
      const headers = { "Cache-Control": "no-store, private" };
      const res401 = await requireOwner({ headers });
      expect(res401).toBeInstanceOf(Response);
      if (res401 instanceof Response) {
        expect(res401.headers.get("Cache-Control")).toBe("no-store, private");
      }

      mockAuth.context = {
        session: { device_id: "dev-1" } as never,
        device: { label: "d", approvedAt: 1, role: "viewer" },
        role: "viewer",
      };
      const res403 = await requireOwner({ headers });
      expect(res403).toBeInstanceOf(Response);
      if (res403 instanceof Response) {
        expect(res403.headers.get("Cache-Control")).toBe("no-store, private");
      }
    });

    it("returns SessionContext when user is owner", async () => {
      const ownerContext: SessionContext = {
        session: { device_id: "dev-owner" } as never,
        device: { label: "d", approvedAt: 1, role: "owner" },
        role: "owner",
      };
      mockAuth.context = ownerContext;
      const res = await requireOwner();
      expect(res).not.toBeInstanceOf(Response);
      expect(res).toEqual(ownerContext);
    });

    it("requireSession allows viewers when minimumRole is viewer", async () => {
      const viewerContext: SessionContext = {
        session: { device_id: "dev-viewer" } as never,
        device: { label: "d", approvedAt: 1, role: "viewer" },
        role: "viewer",
      };
      mockAuth.context = viewerContext;
      const res = await requireSession("viewer");
      expect(res).toEqual(viewerContext);
    });
  });

  describe("guarded", () => {
    it("returns handler response on success", async () => {
      const res = await guarded("test/success", async () => json({ success: true }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
    });

    it("maps a thrown HostError to its status and message", async () => {
      const res = await guarded("test/host-error", async () => {
        throw new HostError("Custom bad input", 400);
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Custom bad input" });
    });

    it("maps a thrown raw ENOENT to 404 Not found", async () => {
      const err = new Error("File missing") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      const res = await guarded("test/enoent", async () => {
        throw err;
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Not found" });
    });

    it("maps an unhandled error to fallback 500", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await guarded("test/unhandled", async () => {
        throw new Error("unexpected crash");
      });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "Operation failed" });
      consoleSpy.mockRestore();
    });
  });
});
