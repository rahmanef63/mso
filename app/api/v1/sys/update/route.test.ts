// Integration tests for /api/v1/sys/update — the route that REPLACES THE CODE THE
// WHOLE COCKPIT RUNS. It shipped with no test at all, which is the wrong end of the
// risk scale to leave uncovered: a regression here does not render a panel wrong,
// it pulls and rebuilds the running deployment.
//
// The route's own job is thin and entirely about refusing: auth, then the boolean,
// then handing off. lib/host/self-update is stubbed so these exercise the WIRING —
// that a signed-out caller gets nothing, that a refusal is a 4xx carrying its
// sentence, and that both outcomes reach the audit trail (this action is the one an
// operator would most want to find in ~/.mso/audit.log afterwards).
import { beforeEach, describe, expect, it, vi } from "vitest";

const authed = { current: true };
vi.mock("@/lib/agent/server", () => ({
  verifyAuth: vi.fn(async () => authed.current),
}));

const getStatus = vi.fn();
const startUpdate = vi.fn();
vi.mock("@/lib/host/self-update", () => ({
  getUpdateStatus: (...args: unknown[]) => getStatus(...args),
  startUpdate: (...args: unknown[]) => startUpdate(...args),
}));

const auditMock = vi.fn();
vi.mock("@/lib/host/audit-api", () => ({
  audit: (...args: unknown[]) => auditMock(...args),
}));

const { GET, POST } = await import("./route");
const { HostError } = await import("@/lib/host/host-error");

const status = (over: Record<string, unknown> = {}) => ({
  supported: true,
  reason: null,
  current: "abc1234",
  currentSubject: "feat: x",
  buildSha: "abc1234",
  pendingBuild: false,
  behind: 2,
  commits: [],
  dirty: false,
  running: false,
  remoteChecked: true,
  log: "",
  ...over,
});

const get = (url = "http://localhost/api/v1/sys/update") => new Request(url);
const post = (body: unknown) =>
  new Request("http://localhost/api/v1/sys/update", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  authed.current = true;
  getStatus.mockReset().mockResolvedValue(status());
  startUpdate.mockReset().mockResolvedValue(status({ running: true }));
  auditMock.mockReset();
});

describe("/api/v1/sys/update", () => {
  it("tells a signed-out caller nothing, on either verb", async () => {
    authed.current = false;
    expect((await GET(get())).status).toBe(401);
    expect((await POST(post({}))).status).toBe(401);
    // Not merely unauthorised — it must not have looked at the host either.
    expect(getStatus).not.toHaveBeenCalled();
    expect(startUpdate).not.toHaveBeenCalled();
  });

  it("asks the remote by default, and skips it for the poller", async () => {
    await GET(get());
    expect(getStatus).toHaveBeenLastCalledWith(true);
    // `?check=0` is what the panel polls with WHILE an update runs — a git fetch
    // every 3s during a build is pure noise.
    await GET(get("http://localhost/api/v1/sys/update?check=0"));
    expect(getStatus).toHaveBeenLastCalledWith(false);
  });

  it("passes rebuildOnly through only when it is exactly true", async () => {
    await POST(post({ rebuildOnly: true }));
    expect(startUpdate).toHaveBeenLastCalledWith(true);
    // A truthy string from a hand-rolled client must not silently mean "rebuild".
    await POST(post({ rebuildOnly: "yes" }));
    expect(startUpdate).toHaveBeenLastCalledWith(false);
    await POST(post({}));
    expect(startUpdate).toHaveBeenLastCalledWith(false);
  });

  it("surfaces a refusal as its sentence, not as a 500", async () => {
    startUpdate.mockRejectedValue(new HostError("already up to date"));
    const res = await POST(post({}));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("already up to date");
  });

  it("audits both the start and the refusal", async () => {
    await POST(post({}));
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "sys.update", ok: true }));

    auditMock.mockReset();
    startUpdate.mockRejectedValue(new HostError("an update is already running"));
    await POST(post({}));
    // A failed attempt is the more interesting line in the log, not the less.
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "sys.update", ok: false }));
  });

  it("does not audit a read", async () => {
    await GET(get());
    expect(auditMock).not.toHaveBeenCalled();
  });
});
