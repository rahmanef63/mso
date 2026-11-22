import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ManagedAppJob } from "@/lib/managed-apps/types";

vi.mock("server-only", () => ({}));

const defaultJob: ManagedAppJob = {
  id: "job-123",
  applicationId: "hermes",
  kind: "update",
  argv: ["hermes", "update"],
  status: "running",
  startedAt: "2026-10-31T00:00:00Z",
  endedAt: null,
  exitCode: null,
  error: null,
  log: "starting...",
  logOffset: 11,
  runnerId: "runner-1",
  serverPid: 1234,
  updatedAt: "2026-10-31T00:00:01Z",
};

const mocks = vi.hoisted(() => ({
  verifyAuth: vi.fn(async (_req: Request, _role?: string) => true),
  getSessionActor: vi.fn(async () => "test-owner"),
  demo: false,
  rateLimited: vi.fn(() => false),
  audit: vi.fn(async () => undefined),
  isManagedAppId: vi.fn((id: string) => id === "hermes" || id === "openclaw"),
  auditJobCompletion: vi.fn(),
  readManagedAppJob: vi.fn<(jobId: string, since?: number) => Promise<ManagedAppJob | null>>(
    async () => defaultJob,
  ),
  cancelManagedAppJob: vi.fn((_jobId: string, _id: string) => true),
}));

vi.mock("@/lib/agent/server", () => ({ verifyAuth: mocks.verifyAuth }));
vi.mock("@/lib/auth/require-session", () => ({ getSessionActor: mocks.getSessionActor }));
vi.mock("@/lib/demo", () => ({ get IS_DEMO() { return mocks.demo; } }));
vi.mock("@/lib/host/limits-api", () => ({ rateLimited: mocks.rateLimited }));
vi.mock("@/lib/host/audit-api", () => ({ audit: mocks.audit }));
vi.mock("@/lib/managed-apps/catalog", () => ({ isManagedAppId: mocks.isManagedAppId }));
vi.mock("@/lib/managed-apps/job-audit", () => ({ auditJobCompletion: mocks.auditJobCompletion }));
vi.mock("@/lib/managed-apps/jobs", () => ({
  readManagedAppJob: mocks.readManagedAppJob,
  cancelManagedAppJob: mocks.cancelManagedAppJob,
}));

import { DELETE, GET } from "./route";

const ctx = (id: string, jobId: string) => ({ params: Promise.resolve({ id, jobId }) });
const getReq = (id: string, jobId: string, query = "") =>
  new Request(`https://mso.example.com/api/v1/managed-apps/${id}/jobs/${jobId}${query}`);
const delReq = (id: string, jobId: string) =>
  new Request(`https://mso.example.com/api/v1/managed-apps/${id}/jobs/${jobId}`, { method: "DELETE" });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyAuth.mockResolvedValue(true);
  mocks.getSessionActor.mockResolvedValue("test-owner");
  mocks.demo = false;
  mocks.rateLimited.mockReturnValue(false);
  mocks.isManagedAppId.mockImplementation((id: string) => id === "hermes" || id === "openclaw");
  mocks.readManagedAppJob.mockResolvedValue(defaultJob);
  mocks.cancelManagedAppJob.mockReturnValue(true);
});

describe("GET /api/v1/managed-apps/[id]/jobs/[jobId]", () => {
  it("returns 401 when unauthenticated and does not read job", async () => {
    mocks.verifyAuth.mockResolvedValue(false);
    const res = await GET(getReq("hermes", "job-123"), ctx("hermes", "job-123"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(mocks.readManagedAppJob).not.toHaveBeenCalled();
  });

  it("returns 404 with distinct 'unknown managed application' error when app is unknown", async () => {
    const res = await GET(getReq("unknown-app", "job-123"), ctx("unknown-app", "job-123"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unknown managed application" });
    expect(mocks.readManagedAppJob).not.toHaveBeenCalled();
  });

  it("returns 404 with distinct 'unknown job' error when job does not exist", async () => {
    mocks.readManagedAppJob.mockResolvedValue(null);
    const res = await GET(getReq("hermes", "job-404"), ctx("hermes", "job-404"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unknown job" });
  });

  it("returns 404 with distinct 'unknown job' error when job belongs to a different app", async () => {
    // Cross-app isolation: a job ID from another app must not leak its transcript
    mocks.readManagedAppJob.mockResolvedValue({
      ...defaultJob,
      applicationId: "openclaw",
    });
    const res = await GET(getReq("hermes", "job-123"), ctx("hermes", "job-123"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unknown job" });
  });

  it("returns job and audits completion on happy path with floored since param", async () => {
    const res = await GET(getReq("hermes", "job-123", "?since=10.7"), ctx("hermes", "job-123"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      job: defaultJob,
    });
    expect(mocks.readManagedAppJob).toHaveBeenCalledWith("job-123", 10);
    expect(mocks.auditJobCompletion).toHaveBeenCalled();
  });
});

describe("DELETE /api/v1/managed-apps/[id]/jobs/[jobId]", () => {
  it("returns 401 when caller is not owner and does not cancel job", async () => {
    mocks.verifyAuth.mockResolvedValue(false);
    const res = await DELETE(delReq("hermes", "job-123"), ctx("hermes", "job-123"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(mocks.verifyAuth).toHaveBeenCalledWith(expect.any(Request), "owner");
    expect(mocks.cancelManagedAppJob).not.toHaveBeenCalled();
  });

  it("returns 403 demo mode is read-only when in demo mode", async () => {
    mocks.demo = true;
    const res = await DELETE(delReq("hermes", "job-123"), ctx("hermes", "job-123"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "demo mode is read-only" });
    expect(mocks.cancelManagedAppJob).not.toHaveBeenCalled();
  });

  it("returns 404 with 'unknown managed application' when app is unknown on delete", async () => {
    const res = await DELETE(delReq("unknown-app", "job-123"), ctx("unknown-app", "job-123"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unknown managed application" });
    expect(mocks.cancelManagedAppJob).not.toHaveBeenCalled();
  });

  it("returns 429 when rate limited on job cancellation", async () => {
    mocks.rateLimited.mockReturnValue(true);
    const res = await DELETE(delReq("hermes", "job-123"), ctx("hermes", "job-123"));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "too many requests" });
    expect(mocks.cancelManagedAppJob).not.toHaveBeenCalled();
  });

  it("returns 404 and audits failure when job is not cancellable", async () => {
    // Non-cancellable when already terminal or during mandatory pre-flight backup
    mocks.cancelManagedAppJob.mockReturnValue(false);
    const res = await DELETE(delReq("hermes", "job-123"), ctx("hermes", "job-123"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "no cancellable job" });
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "managed-app.action",
        actor: "test-owner",
        target: "hermes",
        ok: false,
        detail: "job.cancel",
      }),
    );
  });

  it("returns 202 cancelled: true on happy path and audits success", async () => {
    const res = await DELETE(delReq("hermes", "job-123"), ctx("hermes", "job-123"));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ cancelled: true });
    expect(mocks.cancelManagedAppJob).toHaveBeenCalledWith("job-123", "hermes");
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "managed-app.action",
        actor: "test-owner",
        target: "hermes",
        ok: true,
        detail: "job.cancel",
      }),
    );
  });
});
