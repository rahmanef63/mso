import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const DIR = path.join(os.tmpdir(), `mso-mcp-security-test-${process.pid}`);
process.env.OS_MCP_STORE = path.join(DIR, "mcp.json");

const store = await import("./store");

beforeEach(async () => {
  await fs.rm(DIR, { recursive: true, force: true });
});
afterAll(async () => {
  await fs.rm(DIR, { recursive: true, force: true });
});


describe("durable MCP credential isolation", () => {
  it("assigns every PAT a distinct durable client principal", async () => {
    const first = await store.mintPatToken({ label: "client one", scope: "read", ttlDays: 1 });
    const second = await store.mintPatToken({ label: "client two", scope: "read", ttlDays: 1 });
    const a = await store.validateToken(first.rawToken);
    const b = await store.validateToken(second.rawToken);
    expect(a?.clientId).toMatch(/^manual:pat:[a-f0-9]{24}$/);
    expect(b?.clientId).toMatch(/^manual:pat:[a-f0-9]{24}$/);
    expect(a?.clientId).not.toBe(b?.clientId);
  });

  it("treats refresh-token replay as grant-family compromise", async () => {
    await store.storeOAuthGrant({
      accessToken: "initial-access",
      refreshToken: "initial-refresh",
      label: "oauth",
      clientId: "client-replay",
      scope: "exec",
      resource: "https://mso.example/mcp",
      offlineAccess: true,
      grantId: "grant-replay",
    });
    expect(await store.rotateOAuthGrant({
      oldRefreshToken: "initial-refresh",
      accessToken: "successor-access",
      refreshToken: "successor-refresh",
      label: "oauth",
      clientId: "client-replay",
      resource: "https://mso.example/mcp",
    })).not.toBeNull();
    expect(await store.validateToken("successor-access")).not.toBeNull();

    expect(await store.rotateOAuthGrant({
      oldRefreshToken: "initial-refresh",
      accessToken: "replay-access",
      refreshToken: "replay-refresh",
      label: "oauth",
      clientId: "client-replay",
      resource: "https://mso.example/mcp",
    })).toBeNull();

    expect(await store.validateToken("successor-access")).toBeNull();
    expect(await store.rotateOAuthGrant({
      oldRefreshToken: "successor-refresh",
      accessToken: "after-replay-access",
      refreshToken: "after-replay-refresh",
      label: "oauth",
      clientId: "client-replay",
      resource: "https://mso.example/mcp",
    })).toBeNull();
  });
});
