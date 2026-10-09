import { expect, it, vi } from "vitest";
const device = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/device-store", () => ({ getApprovedDevice: device }));
import { liveCapabilityContext } from "./live-authority";
it("preserves and rechecks a delegated web principal after revocation or demotion", async () => {
  const context = { principal: "web:owner-device", scope: "exec" as const };
  device.mockResolvedValue({ role: "owner" }); expect((await liveCapabilityContext(context, "fs_write")).principal).toBe(context.principal);
  device.mockResolvedValue({ role: "operator" }); await expect(liveCapabilityContext(context, "fs_write")).rejects.toThrow(/demoted/);
  await expect(liveCapabilityContext(context)).rejects.toThrow(/demoted/);
  device.mockResolvedValue(null); await expect(liveCapabilityContext(context, "fs_write")).rejects.toThrow(/revoked/);
});
