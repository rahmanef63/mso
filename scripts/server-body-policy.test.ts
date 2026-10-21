import { describe, expect, it } from "vitest";
import {
  ACCOUNT_ICON_BODY_LIMIT,
  BODY_CLONE_BYPASS,
  FS_UPLOAD_BODY_LIMIT,
  PROXY_BODY_LIMIT,
  requestBodyLimit,
} from "../scripts/server-body-policy.mjs";

describe("request body policy", () => {
  it("keeps the default ceiling small", () => {
    expect(requestBodyLimit("/api/auth/account")).toBe(PROXY_BODY_LIMIT);
    expect(requestBodyLimit("/api/v1/exec/run")).toBe(PROXY_BODY_LIMIT);
    expect(requestBodyLimit("/")).toBe(PROXY_BODY_LIMIT);
  });

  it("names the two large-body routes explicitly", () => {
    expect(requestBodyLimit("/api/v1/fs/upload")).toBe(FS_UPLOAD_BODY_LIMIT);
    expect(requestBodyLimit("/api/auth/account/icon")).toBe(ACCOUNT_ICON_BODY_LIMIT);
    expect(ACCOUNT_ICON_BODY_LIMIT).toBe(8 * 1024 * 1024);
  });

  it("does not widen a route by prefix or by query string", () => {
    // A positive list, not a prefix match: a new sibling is NOT silently allowed.
    expect(requestBodyLimit("/api/auth/account/icon/extra")).toBe(PROXY_BODY_LIMIT);
    expect(requestBodyLimit("/api/auth/account")).toBe(PROXY_BODY_LIMIT);
    expect(requestBodyLimit("/api/v1/fs/upload/anything")).toBe(PROXY_BODY_LIMIT);
    expect(requestBodyLimit("/api/auth/account/icon?size=ico")).toBe(ACCOUNT_ICON_BODY_LIMIT);
    expect(requestBodyLimit("/api/auth/account/iconx")).toBe(PROXY_BODY_LIMIT);
  });

  it("falls back to the default for an unparseable url", () => {
    expect(requestBodyLimit("http://[::")).toBe(PROXY_BODY_LIMIT);
  });

  it("declares the clone bypass for exactly the routes that read their own bytes", () => {
    expect([...BODY_CLONE_BYPASS].sort()).toEqual(["/api/auth/account/icon", "/api/v1/fs/upload"]);
  });
});

describe("matcher synchronization", () => {
  it("keeps the proxy matcher and the bypass list in sync", async () => {
    // The matcher is a literal string (Next reads it at compile time), so the only
    // way to keep it honest is to parse it back out of the source.
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
    const match = /matcher:\s*\[("(?:[^"\\]|\\.)*")\]/.exec(source);
    expect(match?.[1]).toBeTruthy();
    const pattern = new RegExp(`^${JSON.parse(match![1]!)}$`);
    for (const path of BODY_CLONE_BYPASS) expect(pattern.test(path)).toBe(false);
    for (const path of ["/api/auth/account", "/api/auth/account/iconx", "/settings", "/api/v1/exec/run"]) {
      expect(pattern.test(path)).toBe(true);
    }
  });
});
