import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAuth: vi.fn(async () => true),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("@/lib/agent/server", () => ({
  verifyAuth: mocks.verifyAuth,
}));
vi.mock("@/lib/host/fs-api", () => ({
  readFile: mocks.readFile,
  writeFile: mocks.writeFile,
  statReadable: vi.fn(),
  fileStream: vi.fn(),
}));

import { GET, POST } from "./route";
import { HEADLESS_TOOLS } from "@/features/image-editor/server";

function makeReq(url: string, method = "GET", body?: unknown): Request {
  return new Request(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: typeof body === "string" ? body : body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyAuth.mockResolvedValue(true);
  mocks.readFile.mockRejectedValue(new Error("ENOENT"));
  mocks.writeFile.mockResolvedValue(undefined);
});

describe("GET /api/v1/editor/exec", () => {
  it("refuses unauthenticated requests", async () => {
    mocks.verifyAuth.mockResolvedValue(false);
    const res = await GET(makeReq("https://mso.example/api/v1/editor/exec"));
    expect(res.status).toBe(401);
  });

  it("returns available headless tools", async () => {
    const res = await GET(makeReq("https://mso.example/api/v1/editor/exec"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tools: HEADLESS_TOOLS });
  });
});

describe("POST /api/v1/editor/exec", () => {
  it("refuses unauthenticated requests", async () => {
    mocks.verifyAuth.mockResolvedValue(false);
    const res = await POST(makeReq("https://mso.example/api/v1/editor/exec", "POST", {}));
    expect(res.status).toBe(401);
  });

  it("returns 400 on malformed json payload", async () => {
    const res = await POST(makeReq("https://mso.example/api/v1/editor/exec", "POST", "{invalid-json"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid json" });
  });

  it("executes commands on a new blank doc when no doc exists", async () => {
    const res = await POST(
      makeReq("https://mso.example/api/v1/editor/exec", "POST", {
        commands: [{ name: "doc.resize", args: { width: 500, height: 500 } }],
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.doc.width).toBe(500);
    expect(data.doc.height).toBe(500);
    expect(data.results).toHaveLength(1);
    expect(data.results[0]).toEqual({ name: "doc.resize", ok: true, result: "canvas → 500x500" });
  });

  it("refuses to overwrite a path containing non-JSON", async () => {
    mocks.readFile.mockResolvedValue("not-json-content");
    const res = await POST(
      makeReq("https://mso.example/api/v1/editor/exec", "POST", { path: "/tmp/not-doc.txt" }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: `"/tmp/not-doc.txt" exists but is not JSON — refusing to overwrite`,
    });
  });

  it("refuses to overwrite a path containing JSON that is not an editor doc", async () => {
    mocks.readFile.mockResolvedValue(JSON.stringify({ someKey: "not an editor doc" }));
    const res = await POST(
      makeReq("https://mso.example/api/v1/editor/exec", "POST", { path: "/tmp/package.json" }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: `"/tmp/package.json" is not an editor document — refusing to overwrite`,
    });
  });

  it("reads, mutates and writes an existing document", async () => {
    const { blankDoc } = await import("@/features/image-editor/server");
    const existingDoc = blankDoc(400, 300);
    mocks.readFile.mockResolvedValue(JSON.stringify(existingDoc));
    const res = await POST(
      makeReq("https://mso.example/api/v1/editor/exec", "POST", {
        path: "/tmp/project.doc.json",
        commands: [{ name: "doc.resize", args: { width: 800, height: 600 } }],
      }),
    );
    expect(res.status).toBe(200);
    expect(mocks.writeFile).toHaveBeenCalledWith("/tmp/project.doc.json", expect.stringContaining('"width":800'));
    const body = await res.json();
    expect(body.written).toBe("/tmp/project.doc.json");
    expect(body.doc.width).toBe(800);
    expect(body.doc.height).toBe(600);
  });
});
