import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { signSession } from "../lib/auth/session";

const SECRET = "e".repeat(48);
const EPOCH = "epoch-0000000000000000";
vi.mock("@/lib/auth/device-store", () => ({
  currentSessionPolicy: async (scope: string) => ({ scope, epoch: EPOCH, changedAt: 1 }),
  getApprovedDevice: async () => ({ label: "owner", approvedAt: 1, role: "owner" }),
}));

async function loadProxy() {
  vi.resetModules();
  vi.stubEnv("OS_SESSION_SECRET", SECRET);
  vi.stubEnv("NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE", "{id}.mso.example.com");
  vi.stubEnv("OPENCLAW_DASHBOARD_URL", "http://127.0.0.1:18789");
  return (await import("../proxy")).proxy;
}

function upgrade(cookieEpoch: string) {
  const now = Date.now();
  const token = signSession({
    issued_at: now, expires_at: now + 60_000, device_id: "dev-1",
    cookie_scope: "host", cookie_epoch: cookieEpoch,
  }, SECRET);
  return new NextRequest("https://openclaw.mso.example.com/chat", {
    headers: { host: "openclaw.mso.example.com", upgrade: "websocket", connection: "Upgrade", cookie: `session=${token}` },
  });
}

describe("proxy session policy epoch", () => {
  it("rejects a retained token from an older generation of the same scope", async () => {
    const proxy = await loadProxy();
    expect((await proxy(upgrade("epoch-9999999999999999"))).status).toBe(404);
    expect((await proxy(upgrade(EPOCH))).headers.get("x-middleware-rewrite")).toBe("http://127.0.0.1:18789/chat");
  });
});
