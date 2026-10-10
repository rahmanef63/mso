import { describe, expect, it, vi } from "vitest";
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
  const parent = (now=Date.now()) => ({device_id:deviceId,issued_at:now,expires_at:now+3*60*60_000});

  it("keeps short-lived tickets and viewer cookies cryptographically separate", () => {
    const now = Date.now();
    const ticket = createCamoufoxViewerTicket(parent(now), secret, now);
    const cookie = createCamoufoxViewerCookie(parent(now), secret, now);
    expect(verifyCamoufoxViewerTicket(ticket, secret)?.device_id).toBe(deviceId);
    expect(verifyCamoufoxViewerCookie(cookie, secret)?.device_id).toBe(deviceId);
    expect(verifyCamoufoxViewerCookie(ticket, secret)).toBeNull();
    expect(verifyCamoufoxViewerTicket(cookie, secret)).toBeNull();
  });

  it("expires a ticket much sooner than the host-only viewer cookie", () => {
    const old = Date.now() - CAMOUFOX_VIEWER_TICKET_TTL_MS - 1;
    const oldTicket = createCamoufoxViewerTicket(parent(old), secret, old);
    expect(verifyCamoufoxViewerTicket(oldTicket, secret)).toBeNull();
    const earlier = Date.now() - CAMOUFOX_VIEWER_COOKIE_TTL_MS + 60_000;
    const stillValidCookie = createCamoufoxViewerCookie(parent(earlier), secret, earlier);
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
    expect(() => createCamoufoxViewerTicket(parent(), "")).toThrow(/not configured/);
  });

  it("retains the parent expiry and issued-at through ticket redemption", () => {
    vi.useFakeTimers({toFake:["Date"]});
    try {
      const now=Date.now(), session={...parent(now),expires_at:now+45_000};
      const ticket=createCamoufoxViewerTicket(session,secret);
      vi.setSystemTime(now+15_000);
      const redeemed=verifyCamoufoxViewerTicket(ticket,secret)!;
      const cookie=createCamoufoxViewerCookie(redeemed,secret);
      expect(verifyCamoufoxViewerCookie(cookie,secret)).toMatchObject({issued_at:now,expires_at:now+45_000,parent_expires_at:now+45_000});
      vi.setSystemTime(now+45_001);
      expect(verifyCamoufoxViewerCookie(cookie,secret)).toBeNull();
      expect(verifyCamoufoxViewerTicket(ticket,secret)).toBeNull();
    } finally {vi.useRealTimers();}
  });
});
