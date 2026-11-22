import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditRecord } from "@/lib/host/audit";

const sampleRecord: AuditRecord = {
  action: "fs.read",
  actor: "operator-1",
  target: "/tmp",
  ts: "2026-10-31T00:00:00Z",
};

const mocks = vi.hoisted(() => ({
  verifyAuth: vi.fn(async () => true),
  readAuditTail: vi.fn<(opts?: { prefix?: string; limit?: number }) => Promise<AuditRecord[]>>(
    async () => [sampleRecord],
  ),
}));

vi.mock("@/lib/agent/server", () => ({ verifyAuth: mocks.verifyAuth }));
vi.mock("@/lib/host/audit-api", () => ({ readAuditTail: mocks.readAuditTail }));

import { GET } from "./route";

function makeReq(url = "https://mso.example.com/api/v1/sys/audit"): Request {
  return new Request(url);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyAuth.mockResolvedValue(true);
  mocks.readAuditTail.mockResolvedValue([sampleRecord]);
});

describe("GET /api/v1/sys/audit", () => {
  it("returns 401 when unauthenticated and does not call readAuditTail", async () => {
    mocks.verifyAuth.mockResolvedValue(false);
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(mocks.readAuditTail).not.toHaveBeenCalled();
  });

  it("returns audit entries with default limit on happy path", async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      entries: [sampleRecord],
    });
    // Default limit is 50, prefix is undefined
    expect(mocks.readAuditTail).toHaveBeenCalledWith({ prefix: undefined, limit: 50 });
  });

  it("clamps limit between 1 and 200 and forwards prefix", async () => {
    // Upper clamp to 200 prevents unbounded memory allocations
    await GET(makeReq("https://mso.example.com/api/v1/sys/audit?limit=999&prefix=fs."));
    expect(mocks.readAuditTail).toHaveBeenCalledWith({ prefix: "fs.", limit: 200 });

    // Lower clamp to 1 prevents negative or 0 reads
    await GET(makeReq("https://mso.example.com/api/v1/sys/audit?limit=-10"));
    expect(mocks.readAuditTail).toHaveBeenCalledWith({ prefix: undefined, limit: 1 });
  });

  it("filters entries by actor prefix and caps results to limit", async () => {
    // When actor filter is requested, handler pulls up to 200 entries and filters by startsWith
    mocks.readAuditTail.mockResolvedValue([
      { action: "fs.read", actor: "operator-alice", ts: "2026-10-31T00:00:01Z" },
      { action: "fs.write", actor: "operator-bob", ts: "2026-10-31T00:00:02Z" },
      { action: "term.open", actor: "operator-alice-2", ts: "2026-10-31T00:00:03Z" },
    ]);
    const res = await GET(makeReq("https://mso.example.com/api/v1/sys/audit?actor=operator-alice&limit=1"));
    expect(res.status).toBe(200);
    expect(mocks.readAuditTail).toHaveBeenCalledWith({ prefix: undefined, limit: 200 });
    const body = await res.json();
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]).toEqual({ action: "fs.read", actor: "operator-alice", ts: "2026-10-31T00:00:01Z" });
  });
});
