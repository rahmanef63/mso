import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from "vitest";
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
afterEach(() => vi.restoreAllMocks());


describe("durable MCP credential isolation", () => {
  it("protects pending consent at capacity and expires only unreferenced registrations", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_920_000_000_000);
    const pending = await store.registerClient("pending", ["https://fixture.invalid/callback"]);
    for (let i = 1; i < 64; i++) await store.registerClient("other", ["https://fixture.invalid/callback"]);
    await expect(store.registerClient("overflow", ["https://fixture.invalid/callback"])).rejects.toThrow(/registration capacity/);
    expect(await store.getClient(pending)).toMatchObject({ name: "pending" });
    await store.storeCode("pending-code", { clientId: pending, redirectUri: "https://fixture.invalid/callback", codeChallenge: "fixture", scope: "read", expiresAt: Date.now() + 7_200_000 });
    clock.mockReturnValue(1_920_003_600_001);
    const replacement = await store.registerClient("new", ["https://fixture.invalid/callback"]);
    expect(await store.getClient(replacement)).not.toBeNull();
    expect(await store.getClient(pending)).not.toBeNull();
    expect(await store.consumeCode("pending-code")).toMatchObject({ clientId: pending });
  });
  it("reads the size-checked descriptor when the store pathname is replaced", async () => {
    const state = await import("./store-state");
    await state.commitMcpStore({ clients: { original: { name: "fixture", redirectUris: [], createdAt: Date.now() } }, codes: {}, tokens: {}, refreshTokens: {}, spentRefreshTokens: {} });
    const open = fs.open.bind(fs);
    vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await open(...args);
      if (args[0] === process.env.OS_MCP_STORE) {
        await fs.rename(process.env.OS_MCP_STORE!, path.join(DIR, "previous.json"));
        await fs.writeFile(process.env.OS_MCP_STORE!, "x".repeat(4 * 1024 * 1024 + 1), { mode: 0o600 });
      }
      return handle;
    });
    expect(Object.keys((await state.readMcpStore()).clients)).toEqual(["original"]);
  });
  it("rejects growth after the descriptor size check without reading an unbounded body", async () => {
    const state = await import("./store-state");
    await state.commitMcpStore(await state.readMcpStore());
    const open = fs.open.bind(fs);
    vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await open(...args);
      if (args[0] === process.env.OS_MCP_STORE) {
        const stat = handle.stat.bind(handle);
        vi.spyOn(handle, "stat").mockImplementationOnce(async () => {
          const before = await stat();
          await fs.appendFile(process.env.OS_MCP_STORE!, "x".repeat(4 * 1024 * 1024));
          return before;
        });
      }
      return handle;
    });
    await expect(state.readMcpStore()).rejects.toThrow(/changed while reading/);
  });
  it("bounds many rotations, prunes expired access, preserves absolute expiry and rate limits the authenticated family", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    await store.storeOAuthGrant({ accessToken: "a0", refreshToken: "r0", clientId: "bounded", label: "fixture", scope: "exec", resource: "https://fixture.invalid/mcp", grantId: "bounded" });
    for (let index = 1; index <= 300; index++) {
      clock.mockReturnValue(1_800_000_000_000 + index * 30_001);
      await store.rotateOAuthGrant({ oldRefreshToken: `r${index - 1}`, accessToken: `a${index}`, refreshToken: `r${index}`, clientId: "bounded", label: "fixture", resource: "https://fixture.invalid/mcp" });
    }
    await expect(store.rotateOAuthGrant({ oldRefreshToken: "r300", accessToken: "denied", refreshToken: "denied-r", clientId: "bounded", label: "fixture", resource: "https://fixture.invalid/mcp" })).rejects.toBeInstanceOf(store.OAuthRefreshRateLimit);
    const serialized = await fs.readFile(process.env.OS_MCP_STORE!, "utf8"), data = JSON.parse(serialized);
    expect(Object.keys(data.tokens).length).toBeLessThanOrEqual(121);
    expect(Object.keys(data.spentRefreshTokens)).toHaveLength(256);
    expect(Object.values(data.refreshTokens)).toHaveLength(1);
    expect((Object.values(data.refreshTokens)[0] as { expiresAt: number }).expiresAt).toBe(1_800_000_000_000 + store.REFRESH_TOKEN_TTL_MS);
    expect(Buffer.byteLength(serialized)).toBeLessThan(200_000);
    clock.mockReturnValue(1_800_000_000_000 + store.REFRESH_TOKEN_TTL_MS + 1);
    expect(await store.rotateOAuthGrant({ oldRefreshToken: "r300", accessToken: "expired", refreshToken: "expired-r", clientId: "bounded", label: "fixture", resource: "https://fixture.invalid/mcp" })).toBeNull();
  });
  it("refuses count and byte admission without overwriting the private store", async () => {
    const state = await import("./store-state");
    const data = await state.readMcpStore();
    for (let i = 0; i < 65; i++) data.clients["fixture-" + i] = { name: "fixture", redirectUris: [], createdAt: Date.now() };
    await expect(state.commitMcpStore(data)).rejects.toThrow(/capacity/);
    expect(await state.readMcpStore()).toMatchObject({ clients: {} });
    data.clients = { huge: { name: "x".repeat(4 * 1024 * 1024), redirectUris: [], createdAt: Date.now() } };
    await expect(state.commitMcpStore(data)).rejects.toThrow(/size limit/);
    expect(await state.readMcpStore()).toMatchObject({ clients: {} });
  });
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
