import { beforeEach, describe, expect, it, vi } from "vitest";
import { HostError } from "@/lib/host/host-error";

const mocks = vi.hoisted(() => {
  class UploadTooLargeError extends Error {}
  return {
    UploadTooLargeError,
    verifyAuth: vi.fn(async () => true),
    getSessionActor: vi.fn(async () => "test-actor"),
    rateLimited: vi.fn(() => false),
    resolveUploadDest: vi.fn(async () => "/safe/dest"),
    streamFileInto: vi.fn(async () => "ok"),
    parseMultipart: vi.fn(),
    audit: vi.fn(),
  };
});

vi.mock("@/lib/agent/server", () => ({ verifyAuth: mocks.verifyAuth }));
vi.mock("@/lib/auth/require-session", () => ({ getSessionActor: mocks.getSessionActor }));
vi.mock("@/lib/host/limits-api", () => ({ rateLimited: mocks.rateLimited }));
vi.mock("@/lib/host/audit-api", () => ({ audit: mocks.audit }));
vi.mock("@/lib/host/fs-api", () => ({
  boundaryFromContentType: (ct: string | null) => {
    if (!ct || !ct.includes("boundary=")) throw new Error("bad boundary");
    return "test-boundary";
  },
  parseMultipart: mocks.parseMultipart,
  resolveUploadDest: mocks.resolveUploadDest,
  streamFileInto: mocks.streamFileInto,
  UploadTooLargeError: mocks.UploadTooLargeError,
}));
vi.mock("@/lib/managed-apps/origin", () => ({
  managedAppIdForHost: () => null,
  isUnclaimedAppNamespaceHost: () => false,
}));

import { POST } from "./route";

const post = (opts: { body?: string; headers?: Record<string, string> } = {}) =>
  POST(
    new Request("https://mso.example/api/v1/fs/upload", {
      method: "POST",
      headers: {
        host: "mso.example",
        "content-type": "multipart/form-data; boundary=test-boundary",
        "sec-fetch-site": "same-origin",
        ...opts.headers,
      },
      body: opts.body ?? "content",
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyAuth.mockResolvedValue(true);
  mocks.getSessionActor.mockResolvedValue("test-actor");
  mocks.rateLimited.mockReturnValue(false);
  mocks.resolveUploadDest.mockResolvedValue("/safe/dest");
  mocks.streamFileInto.mockResolvedValue("ok");
  mocks.parseMultipart.mockImplementation(async function* () {
    yield {
      name: "dest",
      body: (async function* () {
        yield new TextEncoder().encode("/safe/dest");
      })(),
    };
    yield {
      name: "file",
      filename: "upload.txt",
      body: (async function* () {
        yield new Uint8Array([1, 2, 3]);
      })(),
    };
  });
});

describe("POST /api/v1/fs/upload", () => {
  it("returns 401 when unauthenticated and does not parse body or resolve dest", async () => {
    mocks.verifyAuth.mockResolvedValue(false);
    const res = await post();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(mocks.parseMultipart).not.toHaveBeenCalled();
    expect(mocks.resolveUploadDest).not.toHaveBeenCalled();
  });

  it("returns 429 when rate limited and does not process upload", async () => {
    mocks.rateLimited.mockReturnValue(true);
    const res = await post();
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Too many upload requests, slow down" });
    expect(mocks.parseMultipart).not.toHaveBeenCalled();
  });

  it("returns 400 when multipart header is missing or malformed", async () => {
    const res = await post({ headers: { "content-type": "text/plain" } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "expected multipart/form-data" });
  });

  it("returns 400 when destination is missing in multipart body", async () => {
    mocks.parseMultipart.mockImplementation(async function* () {
      yield {
        name: "file",
        filename: "orphan.txt",
        body: (async function* () {
          yield new Uint8Array([1, 2]);
        })(),
      };
    });
    const res = await post();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid request: dest" });
  });

  it("refuses destination that escapes allowed roots with 400", async () => {
    mocks.resolveUploadDest.mockRejectedValue(new HostError("Path outside writable roots"));
    const res = await post();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Path outside writable roots" });
  });

  it("returns 413 when upload exceeds total size limit", async () => {
    mocks.parseMultipart.mockImplementation(async function* () {
      throw new mocks.UploadTooLargeError("Upload exceeds 200 MiB limit");
    });
    const res = await post();
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "Upload exceeds 200 MiB limit" });
  });

  it("uploads file successfully on happy path", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ written: 1, failed: [] });
    expect(mocks.resolveUploadDest).toHaveBeenCalledWith("/safe/dest");
    expect(mocks.streamFileInto).toHaveBeenCalledWith("/safe/dest", "upload.txt", expect.anything());
  });
});
