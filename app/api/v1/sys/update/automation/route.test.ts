import { beforeEach, describe, expect, it, vi } from "vitest";

const authed = { current: true };
vi.mock("@/lib/agent/server", () => ({ verifyAuth: vi.fn(async () => authed.current) }));

const state = {
  prefs: { auto: true, channel: "stable" as const },
  timer: { installed: true, enabled: true, active: true, nextRun: null },
  active: true,
  last: { lastAttemptAt: null, lastResult: null, consecutiveFailures: 0, detail: null, channel: null },
  drift: null,
};
const readAutomationState = vi.fn(async () => state);
const applyAutomation = vi.fn(async (_patch: unknown, _ctx: unknown) => state);
vi.mock("@/lib/host/update-automation", () => ({
  readAutomationState: () => readAutomationState(),
  applyAutomation: (patch: unknown, ctx: unknown) => applyAutomation(patch, ctx),
}));
const reason = vi.hoisted(() => ({ value: null as string | null }));
vi.mock("@/lib/host/update-host-support", () => ({ automaticUpdateReason: async () => reason.value, execRunner: async () => ({ code: 0, stdout: "", stderr: "" }) }));
const auditMock = vi.fn();
vi.mock("@/lib/host/audit-api", () => ({ audit: (...args: unknown[]) => auditMock(...args) }));

const { GET, POST } = await import("./route");
const { HostError } = await import("@/lib/host/host-error");

const post = (body: unknown) =>
  new Request("http://localhost/api/v1/sys/update/automation", {
    method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  authed.current = true;
  reason.value = null;
  readAutomationState.mockClear();
  applyAutomation.mockClear();
  auditMock.mockReset();
});

describe("/api/v1/sys/update/automation", () => {
  it("tells a signed-out caller nothing and touches no host state", async () => {
    authed.current = false;
    expect((await GET(new Request("http://localhost/api/v1/sys/update/automation"))).status).toBe(401);
    expect((await POST(post({ updates: { auto: true } }))).status).toBe(401);
    expect(readAutomationState).not.toHaveBeenCalled();
    expect(applyAutomation).not.toHaveBeenCalled();
  });

  it("reports the pref together with whether the host can host a timer", async () => {
    reason.value = "software updates require the checkout to be on main (current: feat/x)";
    const body = await (await GET(new Request("http://localhost/api/v1/sys/update/automation"))).json();
    expect(body).toMatchObject({ supported: false, active: true });
    expect(body.reason).toContain("on main");
  });

  it("refuses an unknown key or a non-enum channel instead of dropping it", async () => {
    for (const updates of [{ ref: "origin/main" }, { channel: "nightly" }, { auto: "on" }, {}]) {
      expect((await POST(post({ updates }))).status, JSON.stringify(updates)).toBe(400);
    }
    expect(applyAutomation).not.toHaveBeenCalled();
  });

  it("passes only the validated patch to the shared automation authority", async () => {
    expect((await POST(post({ updates: { auto: true, channel: "main" } }))).status).toBe(200);
    expect(applyAutomation).toHaveBeenCalledWith({ auto: true, channel: "main" }, expect.objectContaining({ root: expect.any(String) }));
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "sys.update", target: "automation", ok: true }));
  });

  it("surfaces a host refusal as its sentence and audits it", async () => {
    applyAutomation.mockRejectedValueOnce(new HostError("automatic updates are unavailable: no systemd user manager"));
    const res = await POST(post({ updates: { auto: true } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("no systemd user manager");
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ target: "automation", ok: false }));
  });
});
