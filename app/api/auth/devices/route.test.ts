import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const CURRENT = "b".repeat(32);
const DEVICE = "a".repeat(32);
const session = { current: "owner" as "viewer" | "operator" | "owner" | null };
const mocks = vi.hoisted(() => ({
  approveDevice: vi.fn(async () => {}),
  setDeviceRole: vi.fn(async () => {}),
  isApproved: vi.fn(async () => true),
  revokeDevice: vi.fn(async () => {}),
  listDevices: vi.fn(async () => ({ approved: {}, pending: {} })),
  terminate: vi.fn(async () => {}),
  audit: vi.fn(async () => {}),
}));

vi.mock("@/lib/auth/require-session", () => ({
  getSessionContext: vi.fn(async () => session.current ? ({
    session: { device_id: CURRENT, issued_at: 1, expires_at: 2 },
    device: { label: "current", approvedAt: 1, role: session.current },
    role: session.current,
  }) : null),
}));
vi.mock("@/lib/auth/device-store", () => ({
  approveDevice: mocks.approveDevice,
  setDeviceRole: mocks.setDeviceRole,
  isApproved: mocks.isApproved,
  revokeDevice: mocks.revokeDevice,
  listDevices: mocks.listDevices,
  isValidDeviceId: (value: unknown) => typeof value === "string" && /^[a-f0-9-]{16,128}$/i.test(value),
}));
vi.mock("@/lib/camoufox/service", () => ({ terminateCamoufoxSessions: mocks.terminate }));
vi.mock("@/lib/host/audit-api", () => ({ audit: mocks.audit }));

const post = (body: unknown) => new NextRequest("https://mso.example/api/auth/devices", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

beforeEach(() => {
  session.current = "owner";
  mocks.approveDevice.mockReset().mockResolvedValue(undefined);
  mocks.setDeviceRole.mockReset().mockResolvedValue(undefined);
  mocks.isApproved.mockReset().mockResolvedValue(true);
  mocks.revokeDevice.mockReset().mockResolvedValue(undefined);
  mocks.listDevices.mockReset().mockResolvedValue({ approved: {}, pending: {} });
  mocks.terminate.mockReset().mockResolvedValue(undefined);
  mocks.audit.mockReset().mockResolvedValue(undefined);
});

describe("device access roles", () => {
  it("requires an owner for listing and every mutation", async () => {
    const { GET, POST } = await import("./route");
    session.current = "operator";
    expect((await GET()).status).toBe(403);
    expect((await POST(post({ action: "approve", deviceId: DEVICE }))).status).toBe(403);
    expect(mocks.approveDevice).not.toHaveBeenCalled();
  });

  it("approves pending devices as viewer unless the owner chooses another role", async () => {
    const { POST } = await import("./route");
    expect((await POST(post({ action: "approve", deviceId: DEVICE, label: "phone" }))).status).toBe(200);
    expect(mocks.approveDevice).toHaveBeenCalledWith(DEVICE, "phone", "viewer");
    await POST(post({ action: "approve", deviceId: DEVICE, role: "operator" }));
    expect(mocks.approveDevice).toHaveBeenLastCalledWith(DEVICE, undefined, "operator");
  });

  it("changes a different device role and audits the decision", async () => {
    const { POST } = await import("./route");
    expect((await POST(post({ action: "set_role", deviceId: DEVICE, role: "operator" }))).status).toBe(200);
    expect(mocks.setDeviceRole).toHaveBeenCalledWith(DEVICE, "operator");
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "auth.device",
      actor: CURRENT,
      target: DEVICE,
      detail: "role=operator",
    }));
  });

  it("refuses to demote or revoke the device making the request", async () => {
    const { POST } = await import("./route");
    expect((await POST(post({ action: "set_role", deviceId: CURRENT, role: "viewer" }))).status).toBe(409);
    expect((await POST(post({ action: "revoke", deviceId: CURRENT }))).status).toBe(409);
    expect(mocks.setDeviceRole).not.toHaveBeenCalled();
    expect(mocks.revokeDevice).not.toHaveBeenCalled();
  });
});

describe("device revocation runtime teardown", () => {
  it("revokes first, then terminates every live Camoufox socket", async () => {
    const { POST } = await import("./route");
    expect((await POST(post({ action: "revoke", deviceId: DEVICE }))).status).toBe(200);
    expect(mocks.revokeDevice).toHaveBeenCalledWith(DEVICE);
    expect(mocks.terminate).toHaveBeenCalledOnce();
    expect(mocks.revokeDevice.mock.invocationCallOrder[0]).toBeLessThan(mocks.terminate.mock.invocationCallOrder[0]);
  });

  it("does not stop the browser when removing only a pending device", async () => {
    mocks.isApproved.mockResolvedValue(false);
    const { POST } = await import("./route");
    expect((await POST(post({ action: "revoke", deviceId: DEVICE }))).status).toBe(200);
    expect(mocks.terminate).not.toHaveBeenCalled();
  });

  it("reports partial teardown failure while keeping the device revoked", async () => {
    mocks.terminate.mockRejectedValue(new Error("user bus unavailable"));
    const { POST } = await import("./route");
    const response = await POST(post({ action: "revoke", deviceId: DEVICE }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "device_revoked_browser_teardown_failed", revoked: true });
    expect(mocks.revokeDevice).toHaveBeenCalledOnce();
  });

  it("also tears down the shared viewer when a device becomes viewer-only", async () => {
    const { POST } = await import("./route");
    expect((await POST(post({ action: "set_role", deviceId: DEVICE, role: "viewer" }))).status).toBe(200);
    expect(mocks.terminate).toHaveBeenCalledOnce();
  });
});
