// Gate order for the update routes: verifyAuth -> demo 403 -> rate limit ->
// action allowlist -> the lib -> audit. The update service itself is mocked
// here (its behaviour is covered in lib/managed-apps/update.test.ts) so these
// tests are only about the gates, the status codes and the wire shape — and so
// that nothing in this file can start a job or spawn a CLI.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ManagedAppJob } from "@/lib/managed-apps/types";

vi.mock("server-only", () => ({}));

const demo = vi.hoisted(() => ({ value: false }));
const authed = vi.hoisted(() => ({ value: true }));

vi.mock("@/lib/agent/server", () => ({ verifyAuth: async () => authed.value }));
// The actor is the approved device behind the session — every destructive line
// in this trail has to be able to answer "by whom", and reading a real cookie
// here would need a request scope these unit calls do not have.
const actor = vi.hoisted(() => ({ value: "device-7f3a" as string | null }));
vi.mock("@/lib/auth/require-session", () => ({ getSessionActor: async () => actor.value }));
vi.mock("@/lib/demo", () => ({
  get IS_DEMO() {
    return demo.value;
  },
}));
// The real audit appends to ~/.mso/audit.log — the OPERATOR's, since this
// runs as them. Spied instead of written. The limiter is faked so the budget
// one test spends cannot leak into the next (it is process-global and has no
// reset); rate-limit.test.ts covers the counting itself.
const limited = vi.hoisted(() => ({ value: false }));
vi.mock("@/lib/host/audit-api", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/host/limits-api", () => ({ rateLimited: vi.fn(() => limited.value) }));
// The lifecycle route shares this trail (and audited no actor either), so it is
// exercised here rather than left to be the one privileged route with no test.
vi.mock("@/lib/managed-apps/manager", () => ({ getManagedApp: vi.fn(), performManagedAppAction: vi.fn() }));
vi.mock("@/lib/managed-apps/update", () => ({
  cachedUpdateStatus: vi.fn(),
  checkUpdate: vi.fn(),
  startUpdate: vi.fn(),
  setChannel: vi.fn(),
  startRollback: vi.fn(),
  startUninstall: vi.fn(),
}));

const { audit } = await import("@/lib/host/audit-api");
const { rateLimited } = await import("@/lib/host/limits-api");
const service = await import("@/lib/managed-apps/update");
const { GET, POST } = await import("./[id]/update/route");
const jobRoute = await import("./[id]/jobs/[jobId]/route");
const lifecycleRoute = await import("./[id]/route");
const manager = await import("@/lib/managed-apps/manager");

const ctx = (id = "hermes") => ({ params: Promise.resolve({ id }) });
const post = (body: unknown, id = "hermes") =>
  POST(new Request("http://localhost/api/v1/managed-apps/x/update", { method: "POST", body: JSON.stringify(body) }), ctx(id));
const get = (id = "hermes") => GET(new Request("http://localhost/api/v1/managed-apps/x/update"), ctx(id));

const job = (over: Partial<ManagedAppJob> = {}): ManagedAppJob =>
  ({ id: "a".repeat(24), applicationId: "hermes", kind: "update", argv: ["/usr/bin/hermes", "update", "--yes"], status: "running", log: "", logOffset: 0, ...over }) as ManagedAppJob;

beforeEach(() => {
  demo.value = false;
  authed.value = true;
  limited.value = false;
  actor.value = "device-7f3a";
  vi.mocked(audit).mockClear();
  vi.mocked(rateLimited).mockClear();
  vi.mocked(manager.performManagedAppAction).mockReset();
  for (const fn of Object.values(service)) vi.mocked(fn).mockReset();
});

describe("the gates, in order", () => {
  it("401s both verbs without a session", async () => {
    authed.value = false;
    expect((await get()).status).toBe(401);
    expect((await post({ action: "check" })).status).toBe(401);
    expect(service.checkUpdate).not.toHaveBeenCalled();
  });

  it("403s every destructive action in demo mode, but still answers a read", async () => {
    demo.value = true;
    expect((await post({ action: "apply" })).status).toBe(403);
    expect(service.startUpdate).not.toHaveBeenCalled();
  });

  it("404s an application id that is not in the catalog", async () => {
    expect((await get("hermes-evil")).status).toBe(404);
    expect((await post({ action: "apply" }, "../../etc")).status).toBe(404);
  });

  it("400s an action outside the allowlist, including one that only looks like a verb", async () => {
    for (const action of ["install", "reset", "wizard", "", 7, undefined]) {
      const response = await post({ action });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "unsupported managed application action" });
    }
    expect(service.startUpdate).not.toHaveBeenCalled();
  });

  it("429s when the limiter says so, on the same per-app bucket the lifecycle route uses", async () => {
    vi.mocked(service.startUpdate).mockResolvedValue(job());
    limited.value = true;
    expect((await post({ action: "apply" })).status).toBe(429);
    expect(service.startUpdate).not.toHaveBeenCalled();
    // One budget per app, not per endpoint — `managed-app:<id>` is the key
    // [id]/route.ts already spends for start/stop/restart/backup.
    expect(rateLimited).toHaveBeenCalledWith("managed-app:hermes", 12, 60_000);
    // The PROBE has its own, because it spawns the CLI and git-fetches twice.
    // A burst of checks must not spend the budget an uninstall needs.
    expect((await post({ action: "check" })).status).toBe(429);
    expect(rateLimited).toHaveBeenLastCalledWith("managed-app-check:hermes", 10, 60_000);
  });
});

describe("what each action answers with", () => {
  // The GET sits OUTSIDE the CSRF gate (proxy.ts covers mutating verbs only)
  // and the session cookie is Domain=mso.rahmanef.com, so any sibling origin can
  // make a browser send it. If it probed, that would be a blind cross-origin
  // trigger for `hermes update --check` — two git fetches in the operator's
  // checkout. It reads the cache; the probe is a POST, behind the gate.
  it("serves the cache on a GET and never probes, however cold the cache is", async () => {
    const cached = { applicationId: "hermes", currentVersion: "v1", checkedAt: null };
    vi.mocked(service.cachedUpdateStatus).mockReturnValue(cached as never);

    expect(await (await get()).json()).toMatchObject({ currentVersion: "v1" });
    expect(service.cachedUpdateStatus).toHaveBeenCalledWith("hermes");
    expect(service.checkUpdate).not.toHaveBeenCalled();
    // Nothing to rate-limit either: a read of a Map is not a spawn.
    expect(rateLimited).not.toHaveBeenCalled();
  });

  it("probes only on POST, and forces a fresh one", async () => {
    const status = { applicationId: "hermes", currentVersion: "v1", updateAvailable: true };
    vi.mocked(service.checkUpdate).mockResolvedValue(status as never);
    expect(await (await post({ action: "check" })).json()).toEqual({ status });
    expect(service.checkUpdate).toHaveBeenLastCalledWith("hermes", true);
  });

  it("answers 202 with the job record, and passes only validated option types through", async () => {
    vi.mocked(service.startUpdate).mockResolvedValue(job());
    const response = await post({ action: "apply", channel: "beta", tag: "2026.7.1-2", dryRun: true, noRestart: "yes" });

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ job: { id: "a".repeat(24) } });
    // `noRestart: "yes"` is not `true`, so it is not a flag. Nothing is coerced.
    expect(service.startUpdate).toHaveBeenCalledWith("hermes", { channel: "beta", tag: "2026.7.1-2", branch: undefined, dryRun: true, noRestart: false });
  });

  it("400s a field of the wrong type instead of stringifying it into an argv", async () => {
    const response = await post({ action: "apply", channel: { toString: "beta" } });
    expect(response.status).toBe(400);
    expect(service.startUpdate).not.toHaveBeenCalled();
  });

  it("maps the lock to 409 and a bad confirmation to 400", async () => {
    vi.mocked(service.startUpdate).mockRejectedValue(new Error("another operation is already running"));
    expect((await post({ action: "apply" })).status).toBe(409);

    vi.mocked(service.startUninstall).mockRejectedValue(new Error("uninstall confirmation does not match the application id"));
    const refused = await post({ action: "uninstall", confirm: "yes" });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: expect.stringContaining("confirmation") });
  });

  it("requires a backup id for a rollback and a channel for a channel switch", async () => {
    expect((await post({ action: "rollback" })).status).toBe(400);
    expect(service.startRollback).not.toHaveBeenCalled();
    expect((await post({ action: "channel" })).status).toBe(400);
    expect(service.setChannel).not.toHaveBeenCalled();
  });

  it("forwards the pin and the confirmation exactly as sent", async () => {
    vi.mocked(service.startRollback).mockResolvedValue(job({ kind: "restore" }));
    await post({ action: "rollback", backupId: "2026-07-25T10-11-12-345Z", pin: "2026.7.1-2" });
    expect(service.startRollback).toHaveBeenCalledWith("hermes", "2026-07-25T10-11-12-345Z", "2026.7.1-2");

    vi.mocked(service.startUninstall).mockResolvedValue(job({ kind: "uninstall" }));
    await post({ action: "uninstall", confirm: "hermes", dryRun: true });
    expect(service.startUninstall).toHaveBeenCalledWith("hermes", "hermes", true);
  });
});

describe("the audit trail", () => {
  it("records enough to reconstruct the operation, including the argv that ran", async () => {
    vi.mocked(service.startUpdate).mockResolvedValue(job());
    await post({ action: "apply", channel: "beta" });

    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "managed-app.action",
        target: "hermes",
        // WHO. 29 of the 34 audit() calls under /api/v1 carry this — including
        // fs/mkdir — and the most destructive actions in the product did not.
        actor: "device-7f3a",
        ok: true,
        detail: "update.apply",
        meta: expect.objectContaining({ jobId: "a".repeat(24), argv: "/usr/bin/hermes update --yes", channel: "beta" }),
      }),
    );
  });

  it("records the refusal too, with why", async () => {
    vi.mocked(service.startUninstall).mockRejectedValue(new Error("hermes is not installed"));
    await post({ action: "uninstall", confirm: "hermes" });

    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ actor: "device-7f3a", ok: false, detail: "update.uninstall", meta: expect.objectContaining({ reason: "hermes is not installed" }) }),
    );
  });

  it("writes the outcome line too, once, so the trail says whether it worked", async () => {
    // Job records are pruned at 20 per app / 30 days, so without this the log
    // said an uninstall had been LAUNCHED and nothing anywhere said how it
    // ended. The line carries the same actor as the launch, matched on jobId.
    const jobs = await import("@/lib/managed-apps/jobs");
    const finished = job({ kind: "uninstall", status: "succeeded", exitCode: 0, endedAt: "2026-07-25T11:00:00.000Z" });
    vi.mocked(service.startUninstall).mockResolvedValue(finished);
    await post({ action: "uninstall", confirm: "hermes" });
    vi.spyOn(jobs, "readManagedAppJob").mockResolvedValue(finished);

    const poll = () => jobRoute.GET(new Request("http://localhost/x"), { params: Promise.resolve({ id: "hermes", jobId: finished.id }) });
    expect((await poll()).status).toBe(200);
    expect((await poll()).status).toBe(200);

    const completions = vi.mocked(audit).mock.calls.filter(([entry]) => entry.detail?.startsWith("job."));
    expect(completions).toHaveLength(1); // polled twice, audited once
    expect(completions[0][0]).toMatchObject({
      action: "managed-app.action",
      target: "hermes",
      actor: "device-7f3a",
      ok: true,
      detail: "job.uninstall.succeeded",
      meta: { jobId: finished.id, exitCode: 0, endedAt: "2026-07-25T11:00:00.000Z" },
    });
  });

  it("records a job that ended badly as such, and only once it has ended", async () => {
    const jobs = await import("@/lib/managed-apps/jobs");
    const running = job({ id: "c".repeat(24), kind: "update", status: "running" });
    vi.spyOn(jobs, "readManagedAppJob").mockResolvedValue(running);
    const poll = (id: string) => jobRoute.GET(new Request("http://localhost/x"), { params: Promise.resolve({ id: "hermes", jobId: id }) });
    await poll(running.id);
    expect(vi.mocked(audit).mock.calls.filter(([entry]) => entry.detail?.startsWith("job."))).toHaveLength(0);

    vi.mocked(jobs.readManagedAppJob).mockResolvedValue({ ...running, status: "interrupted", error: "the cockpit restarted" });
    await poll(running.id);
    expect(audit).toHaveBeenLastCalledWith(
      // No actor: this process never took the request that started it (a job
      // that outlived a deploy). `null` is the honest answer, not a guess.
      expect.objectContaining({ ok: false, actor: null, detail: "job.update.interrupted", meta: expect.objectContaining({ error: "the cockpit restarted" }) }),
    );
  });
});

describe("the lifecycle route shares the trail", () => {
  const act = (action: string) =>
    lifecycleRoute.POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ action }) }), ctx());

  it("attributes a restart and a failed backup to the device that asked", async () => {
    vi.mocked(manager.performManagedAppAction).mockResolvedValue({ id: "hermes" } as never);
    expect((await act("restart")).status).toBe(200);
    expect(audit).toHaveBeenLastCalledWith({ action: "managed-app.action", target: "hermes", actor: "device-7f3a", ok: true, detail: "restart" });

    vi.mocked(manager.performManagedAppAction).mockRejectedValue(new Error("unit is masked"));
    actor.value = null; // an unauthenticated caller cannot reach here, but null is the honest answer
    expect((await act("backup")).status).toBe(409);
    expect(audit).toHaveBeenLastCalledWith({ action: "managed-app.action", target: "hermes", actor: null, ok: false, detail: "backup" });
  });
});

describe("job polling", () => {
  it("404s a job that belongs to another app rather than serving its transcript", async () => {
    const jobs = await import("@/lib/managed-apps/jobs");
    vi.spyOn(jobs, "readManagedAppJob").mockResolvedValue(job({ applicationId: "openclaw" }));
    const response = await jobRoute.GET(new Request("http://localhost/x?since=10"), {
      params: Promise.resolve({ id: "hermes", jobId: "a".repeat(24) }),
    });
    expect(response.status).toBe(404);
  });
});
