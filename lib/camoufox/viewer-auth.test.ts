import { describe, expect, it } from "vitest";
import { signSession } from "@/lib/auth/session";
import {
  CAMOUFOX_VIEWER_COOKIE_TTL_MS,
  CAMOUFOX_VIEWER_TICKET_TTL_MS,
  createCamoufoxViewerCookie,
  createCamoufoxViewerTicket,
  verifyCamoufoxViewerCookie,
  verifyCamoufoxViewerTicket,
} from "./viewer-auth";

describe("Camoufox sibling viewer credentials", () => {
  const secret = "s".repeat(48);
  const deviceId = "dev-1234567890abcdef";

  it("keeps short-lived tickets and viewer cookies cryptographically separate", () => {
    const now = Date.now();
    const ticket = createCamoufoxViewerTicket(deviceId, secret, now);
    const cookie = createCamoufoxViewerCookie(deviceId, secret, now);
    expect(verifyCamoufoxViewerTicket(ticket, secret)?.device_id).toBe(deviceId);
    expect(verifyCamoufoxViewerCookie(cookie, secret)?.device_id).toBe(deviceId);
    expect(verifyCamoufoxViewerCookie(ticket, secret)).toBeNull();
    expect(verifyCamoufoxViewerTicket(cookie, secret)).toBeNull();
  });

  it("expires a ticket much sooner than the host-only viewer cookie", () => {
    const oldTicket = createCamoufoxViewerTicket(deviceId, secret, Date.now() - CAMOUFOX_VIEWER_TICKET_TTL_MS - 1);
    expect(verifyCamoufoxViewerTicket(oldTicket, secret)).toBeNull();
    const stillValidCookie = createCamoufoxViewerCookie(deviceId, secret, Date.now() - CAMOUFOX_VIEWER_COOKIE_TTL_MS + 60_000);
    expect(verifyCamoufoxViewerCookie(stillValidCookie, secret)?.device_id).toBe(deviceId);
  });

  it("never accepts a cockpit session or a weak base secret", () => {
    const now = Date.now();
    const cockpit = signSession({
      issued_at: now,
      expires_at: now + 60_000,
      device_id: deviceId,
      cookie_scope: "host",
      cookie_epoch: "epoch-0000000000000000",
    }, secret);
    expect(verifyCamoufoxViewerTicket(cockpit, secret)).toBeNull();
    expect(verifyCamoufoxViewerCookie(cockpit, secret)).toBeNull();
    expect(verifyCamoufoxViewerTicket("anything", "")).toBeNull();
    expect(() => createCamoufoxViewerTicket(deviceId, "")).toThrow(/not configured/);
  });
});
