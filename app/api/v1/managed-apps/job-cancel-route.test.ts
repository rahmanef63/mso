// DELETE /api/v1/managed-apps/[id]/jobs/[jobId] — the way out of a wedged
// operation. A job holds the app's lock until it reaches a terminal status, so
// one that never finishes makes every later start/stop/restart/update/backup on
// that app answer 409. The only other cure is restarting mso, which is the one
// thing an operator must not do mid-update. Gates are asserted here rather than
// assumed: this verb ends someone's running update.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const demo = vi.hoisted(() => ({ value: false }));
const authed = vi.hoisted(() => ({ value: true }));
const requiredRoles = vi.hoisted(() => [] as Array<string | undefined>);
const limited = vi.hoisted(() => ({ value: false }));
const actor = vi.hoisted(() => ({ value: "device-7f3a" as string | null }));

vi.mock("@/lib/agent/server", () => ({ verifyAuth: async (_req: Request, role?: string) => { requiredRoles.push(role); return authed.value; } }));
vi.mock("@/lib/auth/require-session", () => ({ getSessionActor: async () => actor.value }));
vi.mock("@/lib/demo", () => ({
  get IS_DEMO() {
    return demo.value;
  },
}));
vi.mock("@/lib/host", async () => {
  const real = await vi.importActual<typeof import("@/lib/host")>("@/lib/host");
  return { ...real, audit: vi.fn(async () => undefined), rateLimited: vi.fn(() => limited.value) };
});
// Mocked wholesale: importing the real one would pull in the job runner, and
// nothing in a route test may be able to spawn or signal a process.
vi.mock("@/lib/managed-apps/jobs", () => ({
  cancelManagedAppJob: vi.fn(() => true),
  readManagedAppJob: vi.fn(async () => null),
}));

const { audit, rateLimited } = await import("@/lib/host");
const { cancelManagedAppJob } = await import("@/lib/managed-apps/jobs");
const { DELETE } = await import("./[id]/jobs/[jobId]/route");

const JOB_ID = "a".repeat(24);
const del = (id = "hermes", jobId = JOB_ID) =>
  DELETE(new Request("http://localhost/x", { method: "DELETE" }), { params: Promise.resolve({ id, jobId }) });

beforeEach(() => {
  demo.value = false;
  authed.value = true;
  limited.value = false;
  actor.value = "device-7f3a";
  requiredRoles.length = 0;
  vi.mocked(audit).mockClear();
  vi.mocked(rateLimited).mockClear();
  vi.mocked(cancelManagedAppJob).mockClear().mockReturnValue(true);
});

describe("cancelling a wedged job", () => {
  it("cancels, answers 202, and records who did it", async () => {
    const response = await del();

    expect(response.status).toBe(202);
    expect(requiredRoles).toEqual(["owner"]);
    expect(cancelManagedAppJob).toHaveBeenCalledWith(JOB_ID, "hermes");
    expect(vi.mocked(audit)).toHaveBeenCalledWith(
      expect.objectContaining({ target: "hermes", ok: true, detail: "job.cancel", actor: "device-7f3a" }),
    );
  });

  it("404s when there was nothing cancellable, and still records the attempt", async () => {
    // Already finished, never existed, or still inside its mandatory pre-flight
    // backup — the lib refuses that one rather than abandoning the copy.
    vi.mocked(cancelManagedAppJob).mockReturnValue(false);
    expect((await del()).status).toBe(404);
    expect(vi.mocked(audit)).toHaveBeenCalledWith(expect.objectContaining({ ok: false, detail: "job.cancel" }));
  });

  it("stops at the same gates as every other mutating action", async () => {
    authed.value = false;
    expect((await del()).status).toBe(401);
    authed.value = true;

    demo.value = true;
    expect((await del()).status).toBe(403);
    demo.value = false;

    expect((await del("nope")).status).toBe(404);

    limited.value = true;
    expect((await del()).status).toBe(429);

    expect(cancelManagedAppJob).not.toHaveBeenCalled();
  });
});
