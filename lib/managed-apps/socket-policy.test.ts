import { afterAll, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { CAMOUFOX_VIEWER_COOKIE, createCamoufoxViewerCookie } from "@/lib/camoufox/viewer-auth";

const root = await mkdtemp(path.join(os.tmpdir(), "mso-socket-policy-"));
process.env.OS_DEVICE_STORE = path.join(root, "devices.json");
process.env.OS_SESSION_SECRET = "s".repeat(32);
process.env.NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE = "{id}.mso.example.com";
process.env.CAMOUFOX_VIEWER_ORIGIN = "https://viewer.example.net";
process.env.OS_PUBLIC_ORIGIN = "https://mso.example.com";
const devices = await import("@/lib/auth/device-store");
const { socketPolicy } = await import("./socket-policy");
const { createManagedAppCookie } = await import("./session");
afterAll(async () => { for (const key of ["OS_DEVICE_STORE", "OS_SESSION_SECRET", "NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE", "CAMOUFOX_VIEWER_ORIGIN", "OS_PUBLIC_ORIGIN"]) delete process.env[key]; await rm(root, { recursive: true, force: true }); });

it("enforces session generation and live role/revocation for managed and viewer sockets", async () => {
  const id = "a".repeat(32); await devices.approveDevice(id); await devices.approveDevice("b".repeat(32));
  const issued = Date.now(), policy = await devices.currentSessionPolicy("host");
  const signed = createManagedAppCookie("hermes", { device_id: id, issued_at: issued, expires_at: issued + 60_000, cookie_scope: policy.scope, cookie_epoch: policy.epoch }, process.env.OS_SESSION_SECRET!);
  const managed = new NextRequest("https://hermes.mso.example.com/socket?ticket=upstream", { headers: { host: "hermes.mso.example.com", origin: "https://hermes.mso.example.com", upgrade: "websocket", connection: "Upgrade", cookie: `__Host-mso-managed-app=${signed}`, authorization: "must-not-reach-upstream" } });
  const viewer = new NextRequest("https://viewer.example.net/_mso-camoufox/websockify", { headers: { host: "viewer.example.net", origin: "https://viewer.example.net", upgrade: "websocket", cookie: `${CAMOUFOX_VIEWER_COOKIE}=${createCamoufoxViewerCookie({device_id:id,issued_at:issued,expires_at:issued+60_000}, process.env.OS_SESSION_SECRET!, issued)}` } });
  const decision = await socketPolicy(managed);
  expect(decision?.identity).toBe(id); expect(decision?.headers.cookie).toBeUndefined(); expect(decision?.headers.authorization).toBeUndefined();
  expect(await socketPolicy(viewer)).not.toBeNull();
  await devices.invalidateDeviceSessions(id);
  expect(await socketPolicy(managed)).toBeNull(); expect(await socketPolicy(viewer)).toBeNull();
  await devices.setDeviceRole(id, "viewer"); expect(await socketPolicy(managed)).toBeNull();
  await devices.revokeDevice(id); expect(await socketPolicy(managed)).toBeNull();
});

it("rejects managed-app and Camoufox WebSocket upgrades after their parent deadline", async () => {
  const id="c".repeat(32); await devices.approveDevice(id);
  const now=Date.now(), policy=await devices.currentSessionPolicy("host");
  const parent={device_id:id,issued_at:now,expires_at:now+45_000,cookie_scope:policy.scope,cookie_epoch:policy.epoch};
  const managedCookie=createManagedAppCookie("hermes",parent,process.env.OS_SESSION_SECRET!);
  const viewerCookie=createCamoufoxViewerCookie(parent,process.env.OS_SESSION_SECRET!);
  const managed=new NextRequest("https://hermes.mso.example.com/socket",{headers:{host:"hermes.mso.example.com",origin:"https://hermes.mso.example.com",upgrade:"websocket",cookie:`__Host-mso-managed-app=${managedCookie}`}});
  const viewer=new NextRequest("https://viewer.example.net/_mso-camoufox/websockify",{headers:{host:"viewer.example.net",origin:"https://viewer.example.net",upgrade:"websocket",cookie:`${CAMOUFOX_VIEWER_COOKIE}=${viewerCookie}`}});
  expect(await socketPolicy(managed)).not.toBeNull(); expect(await socketPolicy(viewer)).not.toBeNull();
  vi.useFakeTimers({toFake:["Date"]});
  try {
    vi.setSystemTime(now+45_001);
    expect(await socketPolicy(managed)).toBeNull(); expect(await socketPolicy(viewer)).toBeNull();
  } finally {vi.useRealTimers();}
});
