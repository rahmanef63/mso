import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyUpdate,
  cancelJob,
  checkForUpdate,
  getJob,
  getUpdateStatus,
  listBackups,
  listJobs,
  UpdateApiError,
  uninstallApp,
} from "./update-api";

type Reply = { ok?: boolean; status?: number; body?: unknown };

function stubFetch(...replies: Reply[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const reply = replies.shift() ?? { body: {} };
    const status = reply.status ?? 200;
    return { ok: reply.ok ?? status < 400, status, json: async () => reply.body ?? {} };
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

const bodyOf = (init?: RequestInit) => JSON.parse(String(init?.body));

afterEach(() => vi.unstubAllGlobals());

describe("getUpdateStatus", () => {
  it("normalizes a switchable channel", async () => {
    stubFetch({
      body: {
        currentVersion: "2026.7.1-2",
        latestVersion: "2026.7.4",
        updateAvailable: true,
        detail: "registry: 2026.7.4 > installed 2026.7.1-2",
        channel: { value: "stable", kind: "channel", available: ["stable", "beta", 7], switchable: true, reason: null },
        installKind: "package",
        checkedAt: "2026-07-25T10:00:00.000Z",
      },
    });
    const status = await getUpdateStatus("openclaw");
    expect(status.currentVersion).toBe("2026.7.1-2");
    expect(status.updateAvailable).toBe(true);
    expect(status.detail).toContain("2026.7.4");
    // Non-string channel entries are dropped, never rendered as "7".
    expect(status.channel).toEqual({
      value: "stable",
      kind: "channel",
      available: ["stable", "beta"],
      switchable: true,
      reason: null,
    });
    expect(status.installKind).toBe("package");
  });

  it("keeps a branch that names itself but cannot be switched", async () => {
    // Hermes: `kind: "branch"`, nothing selectable. The panel has to be able to
    // tell that apart from "no channel at all", so the object survives.
    const channel = { value: "main", kind: "branch", available: [], switchable: false, reason: "switching a branch rewrites the checkout" };
    stubFetch({ body: { channel } });
    const status = await getUpdateStatus("hermes");
    expect(status.channel).toMatchObject({ value: "main", kind: "branch", switchable: false });
    expect(status.channel?.reason).toMatch(/rewrites the checkout/);
  });

  it("carries a probe failure through as an error, not as 'up to date'", async () => {
    stubFetch({ body: { updateAvailable: null, error: "hermes is not installed", checkedAt: "2026-07-25T10:00:00.000Z" } });
    const status = await getUpdateStatus("hermes");
    expect(status.error).toBe("hermes is not installed");
    expect(status.updateAvailable).toBeNull();
  });

  it("turns everything the route omits into null, not undefined", async () => {
    stubFetch({ body: { currentVersion: "0.19.0" } });
    const status = await getUpdateStatus("hermes");
    expect(status).toMatchObject({
      currentVersion: "0.19.0",
      latestVersion: null,
      // `null` is "never checked" — deliberately not the same as `false`.
      updateAvailable: null,
      channel: null,
      checkedAt: null,
      capabilities: null,
    });
  });

  it("surfaces the server's error text", async () => {
    stubFetch({ status: 503, body: { error: "hermes CLI not on PATH" } });
    await expect(getUpdateStatus("hermes")).rejects.toThrow("hermes CLI not on PATH");
  });

  it("names the lock on a bare 409 — the same string the manager uses", async () => {
    stubFetch({ status: 409, body: {} });
    await expect(getUpdateStatus("hermes")).rejects.toThrow("another operation is already running");
  });

  it("explains a 429 and a demo 403", async () => {
    stubFetch({ status: 429, body: {} }, { status: 403, body: {} });
    await expect(getUpdateStatus("hermes")).rejects.toThrow(/rate limited/);
    await expect(getUpdateStatus("hermes")).rejects.toBeInstanceOf(UpdateApiError);
  });
});

describe("actions", () => {
  it("posts apply with its options and returns the job id", async () => {
    const calls = stubFetch({ body: { jobId: "a".repeat(24) } });
    const result = await applyUpdate("openclaw", { channel: "beta", dryRun: true });
    expect(calls[0].url).toBe("/api/v1/managed-apps/openclaw/update");
    expect(calls[0].init?.method).toBe("POST");
    expect(bodyOf(calls[0].init)).toEqual({ action: "apply", channel: "beta", dryRun: true });
    expect(result).toEqual({ jobId: "a".repeat(24), status: null });
  });

  it("echoes the app id as the uninstall confirmation", async () => {
    const calls = stubFetch({ body: { job: { id: "b".repeat(24) } } });
    const result = await uninstallApp("hermes", "hermes");
    expect(bodyOf(calls[0].init)).toEqual({ action: "uninstall", confirm: "hermes" });
    // A `{ job: { id } }` envelope is accepted as readily as a bare jobId.
    expect(result.jobId).toBe("b".repeat(24));
  });

  it("reads check's inline answer, wrapped or bare", async () => {
    stubFetch({ body: { status: { currentVersion: "1.0", updateAvailable: false } } });
    const wrapped = await checkForUpdate("hermes");
    expect(wrapped.jobId).toBeNull();
    expect(wrapped.status?.updateAvailable).toBe(false);
  });

  it("refuses to report a bodyless ack as a status", async () => {
    stubFetch({ body: { ok: true } });
    // Nothing in it is a status field, so the panel keeps what it already had.
    expect(await checkForUpdate("hermes")).toEqual({ jobId: null, status: null });
  });
});

describe("job polling", () => {
  it("sends the cursor and fills in the id the route omits", async () => {
    const calls = stubFetch({ body: { status: "running", log: "step 2\n", logOffset: 14 } });
    const job = await getJob("hermes", "c".repeat(24), 7);
    expect(calls[0].url).toBe(`/api/v1/managed-apps/hermes/jobs/${"c".repeat(24)}?since=7`);
    expect(job).toMatchObject({ id: "c".repeat(24), status: "running", log: "step 2\n", logOffset: 14 });
  });

  it("returns null for a record that is gone, and rethrows anything else", async () => {
    stubFetch({ status: 404, body: {} }, { status: 500, body: { error: "boom" } });
    expect(await getJob("hermes", "d".repeat(24))).toBeNull();
    await expect(getJob("hermes", "d".repeat(24))).rejects.toThrow("boom");
  });

  it("drops history rows that carry no status", async () => {
    stubFetch({ body: { jobs: [{ id: "e".repeat(24), status: "succeeded" }, { id: "f".repeat(24) }, null] } });
    const jobs = await listJobs("openclaw");
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe("succeeded");
  });
});

describe("backups", () => {
  it("reads a manifest row, and the aliases a route may use instead", async () => {
    stubFetch({
      body: {
        backups: [
          {
            id: "2026-07-25T09-00-00-000Z",
            createdAt: "2026-07-25T09:00:00.000Z",
            source: "/home/operator/.hermes",
            reason: "pre-update",
            files: 8421,
            bytes: 383778816,
            skipped: { symlinks: 1, dirs: 4, dirNames: ["node_modules", ".git", 9] },
          },
          { name: "2026-07-24T09-00-00-000Z", path: "/home/operator/.openclaw", size: 1024 },
        ],
      },
    });
    const result = await listBackups("hermes");
    expect(result.supported).toBe(true);
    expect(result.backups[0]).toEqual({
      id: "2026-07-25T09-00-00-000Z",
      createdAt: "2026-07-25T09:00:00.000Z",
      sizeBytes: 383778816,
      source: "/home/operator/.hermes",
      reason: "pre-update",
      files: 8421,
      // What this snapshot never held is what restoring it cannot bring back,
      // so it travels per row — and a non-string name is dropped, not shown.
      skippedDirs: ["node_modules", ".git"],
      skippedSymlinks: 1,
    });
    expect(result.backups[1]).toMatchObject({ id: "2026-07-24T09-00-00-000Z", sizeBytes: 1024, reason: null, skippedDirs: [] });
  });

  it("reads a 404 as 'this build has no backups route', not as 'no backups'", async () => {
    stubFetch({ status: 404, body: {} });
    expect(await listBackups("openclaw")).toEqual({ supported: false, backups: [] });
  });
});

describe("cancelling a job", () => {
  it("DELETEs the job and reports whether there was one to cancel", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ cancelled: true }), { status: 202 }));
    await expect(cancelJob("hermes", "a".repeat(24))).resolves.toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain(`/hermes/jobs/${"a".repeat(24)}`);
    expect((init as RequestInit).method).toBe("DELETE");

    // 404 = nothing cancellable (already finished, or never existed). Not an
    // error to surface: the poll loop is about to report the real outcome.
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "no cancellable job" }), { status: 404 }));
    await expect(cancelJob("hermes", "b".repeat(24))).resolves.toBe(false);

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "nope" }), { status: 500 }));
    await expect(cancelJob("hermes", "c".repeat(24))).rejects.toThrow();
  });
});
