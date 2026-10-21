import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";

/** The proxy ceiling used to be a flat 1 MiB, so the owner icon upload (8 MiB route
 *  cap) could never receive a phone photo: middleware returned 413 before the route
 *  ran. It is now per-path from scripts/server-body-policy.mjs, and a positive list
 *  means a new sibling route is not silently widened. */
function request(path: string, bytes: number) {
  return new NextRequest(new URL(`https://mso.example.com${path}`), {
    method: "POST",
    headers: { "content-length": String(bytes), host: "mso.example.com" },
  });
}

describe("proxy request body ceiling", () => {
  it("rejects an ordinary route above 1 MiB", async () => {
    expect((await proxy(request("/api/auth/account", 1025 * 1024))).status).toBe(413);
  });

  it("lets the owner icon upload reach its own 8 MiB cap", async () => {
    expect((await proxy(request("/api/auth/account/icon", 2 * 1024 * 1024))).status).not.toBe(413);
    expect((await proxy(request("/api/auth/account/icon", 9 * 1024 * 1024))).status).toBe(413);
  });

  it("does not widen a sibling path", async () => {
    expect((await proxy(request("/api/auth/account/iconx", 2 * 1024 * 1024))).status).toBe(413);
  });

  it("still allows the streaming filesystem upload", async () => {
    expect((await proxy(request("/api/v1/fs/upload", 2 * 1024 * 1024))).status).not.toBe(413);
  });
});
