import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(async () => true),
  approveDevice: vi.fn(async () => {}),
  isApproved: vi.fn(async () => true),
  revokeDevice: vi.fn(async () => {}),
  listDevices: vi.fn(async () => ({ approved: {}, pending: {} })),
  terminate: vi.fn(async () => {}),
}));

vi.mock("@/lib/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/auth/device-store", () => ({
  approveDevice: mocks.approveDevice,
  isApproved: mocks.isApproved,
  revokeDevice: mocks.revokeDevice,
  listDevices: mocks.listDevices,
  isValidDeviceId: (value: unknown) => typeof value === "string" && /^[a-f0-9-]{16,128}$/i.test(value),
}));
vi.mock("@/lib/camoufox/service", () => ({ terminateCamoufoxSessions: mocks.terminate }));

const DEVICE = "a".repeat(32);
const post = (body: unknown) => new NextRequest("https://mso.example/api/auth/devices", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockClear();
  mocks.requireSession.mockResolvedValue(true);
  mocks.isApproved.mockResolvedValue(true);
  mocks.terminate.mockResolvedValue(undefined);
});

describe("device revocation runtime teardown", () => {
  it("revokes first, then terminates every live Camoufox socket", async () => {
    const { POST } = await import("./route");
    const res = await POST(post({ action: "revoke", deviceId: DEVICE }));
    expect(res.status).toBe(200);
    expect(mocks.revokeDevice).toHaveBeenCalledWith(DEVICE);
    expect(mocks.terminate).toHaveBeenCalledOnce();
    expect(mocks.revokeDevice.mock.invocationCallOrder[0]).toBeLessThan(mocks.terminate.mock.invocationCallOrder[0]);
  });

  it("does not stop the browser when removing only a pending device", async () => {
    mocks.isApproved.mockResolvedValue(false);
    const { POST } = await import("./route");
    expect((await POST(post({ action: "revoke", deviceId: DEVICE }))).status).toBe(200);
    expect(mocks.revokeDevice).toHaveBeenCalledOnce();
    expect(mocks.terminate).not.toHaveBeenCalled();
  });

  it("reports partial failure honestly while keeping the device revoked", async () => {
    mocks.terminate.mockRejectedValue(new Error("user bus unavailable"));
    const { POST } = await import("./route");
    const res = await POST(post({ action: "revoke", deviceId: DEVICE }));
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: "device_revoked_browser_teardown_failed", revoked: true });
    expect(mocks.revokeDevice).toHaveBeenCalledOnce();
  });

  it("does not touch browser runtime during approval", async () => {
    const { POST } = await import("./route");
    expect((await POST(post({ action: "approve", deviceId: DEVICE, label: "phone" }))).status).toBe(200);
    expect(mocks.approveDevice).toHaveBeenCalledWith(DEVICE, "phone");
    expect(mocks.terminate).not.toHaveBeenCalled();
  });
});
