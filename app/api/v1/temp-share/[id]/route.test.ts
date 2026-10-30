import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAuth: vi.fn(async () => true),
  inspectTempShare: vi.fn(),
  consumeTempShare: vi.fn(),
}));

vi.mock("@/lib/agent/server", () => ({ verifyAuth: mocks.verifyAuth }));
vi.mock("@/lib/host/temp-share-api", () => ({
  inspectTempShare: mocks.inspectTempShare,
  consumeTempShare: mocks.consumeTempShare,
}));

import { GET, HEAD } from "./route";

const context = (id = "share-123") => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyAuth.mockResolvedValue(true);
  mocks.inspectTempShare.mockResolvedValue({
    name: "report.pdf",
    mimeType: "application/pdf",
    bytes: 1024,
    expiresAt: Date.now() + 60_000,
    downloadsLeft: 3,
  });
  mocks.consumeTempShare.mockResolvedValue({
    name: "report.pdf",
    mimeType: "application/pdf",
    bytes: 1024,
    expiresAt: Date.now() + 60_000,
    downloadsLeft: 2,
    data: Buffer.from("pdf-data"),
  });
});

describe("HEAD /api/v1/temp-share/[id]", () => {
  it("refuses unauthenticated requests", async () => {
    mocks.verifyAuth.mockResolvedValue(false);
    const res = await HEAD(new Request("https://mso.example/api/v1/temp-share/share-123"), context());
    expect(res.status).toBe(401);
    expect(mocks.inspectTempShare).not.toHaveBeenCalled();
  });

  it("returns 404 when share is not found or expired", async () => {
    mocks.inspectTempShare.mockRejectedValue(new Error("not found"));
    const res = await HEAD(new Request("https://mso.example/api/v1/temp-share/share-123"), context());
    expect(res.status).toBe(404);
  });

  it("returns 200 metadata headers without body on valid share", async () => {
    const res = await HEAD(new Request("https://mso.example/api/v1/temp-share/share-123"), context());
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-length")).toBe("1024");
    expect(res.headers.get("content-disposition")).toContain("inline");
    expect(res.headers.get("x-temp-downloads-left")).toBe("3");
    expect(mocks.inspectTempShare).toHaveBeenCalledWith("share-123");
  });
});

describe("GET /api/v1/temp-share/[id]", () => {
  it("refuses unauthenticated requests", async () => {
    mocks.verifyAuth.mockResolvedValue(false);
    const res = await GET(new Request("https://mso.example/api/v1/temp-share/share-123"), context());
    expect(res.status).toBe(401);
    expect(mocks.consumeTempShare).not.toHaveBeenCalled();
  });

  it("returns 404 when share cannot be consumed", async () => {
    mocks.consumeTempShare.mockRejectedValue(new Error("expired"));
    const res = await GET(new Request("https://mso.example/api/v1/temp-share/share-123"), context());
    expect(res.status).toBe(404);
  });

  it("consumes share and returns binary stream with attachment header if download=1", async () => {
    const res = await GET(
      new Request("https://mso.example/api/v1/temp-share/share-123?download=1"),
      context("share-123"),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("attachment");
    const text = await res.text();
    expect(text).toBe("pdf-data");
    expect(mocks.consumeTempShare).toHaveBeenCalledWith("share-123");
  });
});
