import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

afterEach(() => vi.unstubAllEnvs());

it("forces a network reload after the viewer ticket exchange", async () => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE", "{id}.mso.example.com");
  vi.stubEnv("OS_PUBLIC_ORIGIN", "https://mso.example.com");
  vi.stubEnv("OS_SESSION_COOKIE_DOMAIN", "mso.example.com");
  vi.stubEnv("CAMOUFOX_NOVNC_URL", "http://127.0.0.1:6080");
  vi.stubEnv("CAMOUFOX_VIEWER_ORIGIN", "https://camoufox-mso.example.com");
  const proxy = (await import("../../proxy")).proxy;
  const response = await proxy(new NextRequest(
    "https://camoufox-mso.example.com/__viewer_bootstrap.js",
    { headers: { host: "camoufox-mso.example.com" } },
  ));
  expect(response.status).toBe(200);
  const script = await response.text();
  expect(script).toContain("p.delete('viewer_ticket')");
  expect(script).toContain("history.replaceState");
  expect(script).toContain("p.toString()");
  expect(script).toContain("location.reload()");
  expect(script).not.toContain("location.replace(");
});
