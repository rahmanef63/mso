import { afterAll, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { deviceSessionValid } from "./live-session";
import { createCamoufoxViewerCookie, createCamoufoxViewerTicket, verifyCamoufoxViewerCookie, verifyCamoufoxViewerTicket } from "@/lib/camoufox/viewer-auth";

const root = await mkdtemp(path.join(os.tmpdir(), "mso-live-session-"));
process.env.OS_DEVICE_STORE = path.join(root, "devices.json");
const devices = await import("./device-store");
afterAll(async () => { delete process.env.OS_DEVICE_STORE; await rm(root, { recursive: true, force: true }); });

it("invalidates derived viewer cookies and tickets durably at logout and after reapproval", async () => {
  const id = "a".repeat(32), secret = "s".repeat(32);
  await devices.approveDevice(id); await devices.approveDevice("b".repeat(32));
  const issued = Date.now();
  const ticket = verifyCamoufoxViewerTicket(createCamoufoxViewerTicket(id, secret, issued, issued), secret)!;
  const cookie = verifyCamoufoxViewerCookie(createCamoufoxViewerCookie(id, secret, Date.now(), ticket.issued_at), secret)!;
  expect(deviceSessionValid(cookie, await devices.getApprovedDevice(id))).toBe(true);
  await devices.invalidateDeviceSessions(id);
  expect(deviceSessionValid(cookie, await devices.getApprovedDevice(id))).toBe(false);
  const replay = verifyCamoufoxViewerCookie(createCamoufoxViewerCookie(id, secret, Date.now(), ticket.issued_at), secret)!;
  expect(deviceSessionValid(replay, await devices.getApprovedDevice(id))).toBe(false);
  await devices.revokeDevice(id); await devices.approveDevice(id);
  expect(deviceSessionValid(cookie, await devices.getApprovedDevice(id))).toBe(false);
});
