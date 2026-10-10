import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { signSession, verifySession } from "@/lib/auth/session";
const device = vi.hoisted(() => ({ role: "owner", approved: true }));
vi.mock("@/lib/auth/device-store", () => ({ getApprovedDevice: async () => device.approved ? { approvedAt: 1, role: device.role } : null, currentSessionPolicy: async (scope: string) => ({ scope, epoch: "epoch-0000000000000000" }) }));
const secret = "s".repeat(32);
beforeEach(() => { vi.resetModules(); vi.stubEnv("NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE", "{id}.mso.example.com"); vi.stubEnv("OS_PUBLIC_ORIGIN", "https://mso.example.com"); vi.stubEnv("OS_SESSION_SECRET", secret); device.role = "owner"; device.approved = true; });
afterEach(() => vi.unstubAllEnvs());
const payload = () => ({ issued_at: Date.now(), expires_at: Date.now() + 3600000, device_id: "a".repeat(32), cookie_scope: "host", cookie_epoch: "epoch-0000000000000000" });
it("binds tickets and cookies to one app origin and separate signing purposes", async () => {
  const auth = await import("./session"), session = payload();
  const ticket = auth.createManagedAppTicket("hermes", session, secret), cookie = auth.createManagedAppCookie("hermes", session, secret);
  expect(auth.verifyManagedAppSession("hermes", ticket, secret, "ticket")).not.toBeNull();
  expect(auth.verifyManagedAppSession("openclaw", ticket, secret, "ticket")).toBeNull();
  expect(auth.verifyManagedAppSession("hermes", ticket, secret)).toBeNull();
  expect(auth.verifyManagedAppSession("hermes", signSession(session, secret), secret)).toBeNull();
  expect(verifySession(cookie, secret)).toBeNull(); expect(verifySession(ticket, secret)).toBeNull();
  expect(auth.verifyManagedAppSession("hermes", auth.createManagedAppTicket("hermes", session, secret, Date.now() - 120000), secret, "ticket")).toBeNull();
});
it("exchanges a fresh ticket for a host-only cookie and rechecks revocation and role", async () => {
  const auth = await import("./session");
  const ticket = auth.createManagedAppTicket("hermes", payload(), secret);
  const exchange = await auth.gateManagedApp(new NextRequest("https://hermes.mso.example.com/__mso_app_auth", { method: "POST", headers: { origin: "https://hermes.mso.example.com", authorization: "Bearer " + ticket } }), "hermes");
  expect(exchange?.status).toBe(204);
  const cookie = exchange!.headers.getSetCookie()[0]; expect(cookie).toContain("__Host-mso-managed-app="); expect(cookie).not.toMatch(/Domain=/i); expect(cookie).toContain("Secure"); expect(cookie).toContain("HttpOnly");
  const request = new Request("https://hermes.mso.example.com/", { headers: { cookie: cookie.split(";")[0] } });
  expect(await auth.managedAppSession(request, "hermes")).not.toBeNull();
  device.role = "viewer"; expect(await auth.managedAppSession(request, "hermes")).toBeNull();
  device.role = "owner"; device.approved = false; expect(await auth.managedAppSession(request, "hermes")).toBeNull();
});
it("refuses cockpit cookies, wrong-origin exchange and unauthenticated subresources", async () => {
  const auth = await import("./session");
  const request = new NextRequest("https://hermes.mso.example.com/api", { headers: { cookie: "session=" + signSession(payload(), secret) } });
  expect((await auth.gateManagedApp(request, "hermes"))?.status).toBe(401);
  expect((await auth.gateManagedApp(new NextRequest("https://hermes.mso.example.com/__mso_app_auth", { method: "POST", headers: { origin: "https://mso.example.com" } }), "hermes"))?.status).toBe(403);
});

it("does not extend the cockpit deadline when redeeming a ticket for an HTTP cookie", async () => {
  const auth=await import("./session");
  vi.useFakeTimers({toFake:["Date"]});
  try {
    const now=Date.now(), session={...payload(),expires_at:now+45_000};
    const ticket=auth.createManagedAppTicket("hermes",session,secret);
    vi.setSystemTime(now+15_000);
    const exchange=await auth.gateManagedApp(new NextRequest("https://hermes.mso.example.com/__mso_app_auth",{method:"POST",headers:{origin:"https://hermes.mso.example.com",authorization:"Bearer "+ticket}}),"hermes");
    expect(exchange?.status).toBe(204);
    const cookie=exchange!.headers.getSetCookie()[0].split(";")[0];
    const request=new Request("https://hermes.mso.example.com/",{headers:{cookie}});
    expect(await auth.managedAppSession(request,"hermes")).toMatchObject({issued_at:now,expires_at:now+45_000,parent_expires_at:now+45_000});
    vi.setSystemTime(now+45_001);
    expect(await auth.managedAppSession(request,"hermes")).toBeNull();
  } finally {vi.useRealTimers();}
});
