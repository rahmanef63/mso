import { describe, expect, it, vi } from "vitest";
import { handlePostSysUpdate } from "./sys-update-service";

// Regression: the check action compared Origin against OS_PUBLIC_ORIGIN only, so a
// browser on the host itself (http://127.0.0.1:4005) always got 403 and Settings
// showed "Sign in as an Owner". Same-origin means the request's own host or the
// configured public origin.
vi.mock("@/lib/agent/server", () => ({ verifyAuth: async () => true }));
vi.mock("./self-update", () => ({ getUpdateStatus: async () => ({ current: "abc" }), startUpdate: async () => ({}) }));

function check(origin: string | null, host = "127.0.0.1:4005") {
  const headers = new Headers({ "content-type": "application/json", host });
  if (origin) headers.set("origin", origin);
  return handlePostSysUpdate(new Request("http://127.0.0.1:4005/api/v1/sys/update", {
    method: "POST", headers, body: JSON.stringify({ action: "check" }),
  }));
}

describe("update check same-origin gate", () => {
  it("accepts a browser on the host itself", async () => {
    process.env.OS_PUBLIC_ORIGIN = "https://mso-dev.example.com";
    expect((await check("http://127.0.0.1:4005")).status).toBe(200);
  });

  it("accepts the configured public origin", async () => {
    process.env.OS_PUBLIC_ORIGIN = "https://mso-dev.example.com";
    expect((await check("https://mso-dev.example.com", "mso-dev.example.com")).status).toBe(200);
  });

  it("still refuses a foreign origin", async () => {
    process.env.OS_PUBLIC_ORIGIN = "https://mso-dev.example.com";
    const response = await check("https://evil.example.net");
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "same_origin_required" });
  });
});
