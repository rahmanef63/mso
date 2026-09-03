import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const DIR = path.join(os.tmpdir(), `mso-mcp-test-${process.pid}`);
process.env.OS_MCP_STORE = path.join(DIR, "mcp.json");

const store = await import("./store");
const { sha256hex } = await import("./pkce");

beforeEach(async () => {
  await fs.rm(DIR, { recursive: true, force: true });
});
afterAll(async () => {
  await fs.rm(DIR, { recursive: true, force: true });
});

describe("codes", () => {
  const rec = () => ({
    clientId: "c1",
    redirectUri: "https://chatgpt.com/cb",
    codeChallenge: "chal",
    scope: "read" as const,
    expiresAt: Date.now() + 60_000,
  });

  it("round-trips a code exactly once — a replay finds nothing", async () => {
    await store.storeCode("code-1", rec());
    expect(await store.consumeCode("code-1")).toMatchObject({ clientId: "c1", scope: "read" });
    expect(await store.consumeCode("code-1")).toBeNull();
  });

  it("refuses an expired code", async () => {
    await store.storeCode("old", { ...rec(), expiresAt: Date.now() - 1 });
    expect(await store.consumeCode("old")).toBeNull();
  });

  it("serializes concurrent code exchanges so exactly one caller can consume a code", async () => {
    await store.storeCode("race-code", rec());
    const results = await Promise.all(Array.from({ length: 16 }, () => store.consumeCode("race-code")));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("never writes the raw code to disk", async () => {
    await store.storeCode("super-secret-code", rec());
    const raw = await fs.readFile(process.env.OS_MCP_STORE!, "utf8");
    expect(raw).not.toContain("super-secret-code");
    expect(raw).toContain(sha256hex("super-secret-code"));
  });
});

describe("tokens", () => {
  const mint = (t: string, scope: "read" | "write" | "exec" = "read") =>
    store.storeToken(t, { label: "test", clientId: "c1", scope });

  it("validates a live token and never stores it raw", async () => {
    await mint("tok-live");
    expect(await store.validateToken("tok-live")).toMatchObject({ scope: "read", label: "test" });
    const raw = await fs.readFile(process.env.OS_MCP_STORE!, "utf8");
    expect(raw).not.toContain("tok-live");
  });

  it("rejects an unknown token", async () => {
    expect(await store.validateToken("nope")).toBeNull();
    expect(await store.validateToken("")).toBeNull();
  });

  it("stops validating the instant a token is revoked — this IS the kill switch", async () => {
    await mint("tok-revoke");
    const listed = (await store.listTokens())[0];
    expect(await store.revokeToken(listed.id)).toBe(true);
    expect(await store.validateToken("tok-revoke")).toBeNull();
    expect(await store.revokeToken(listed.id)).toBe(false); // already dead
  });

  it("revokeAll kills every live token and reports the count", async () => {
    await mint("a");
    await mint("b");
    await mint("c");
    expect(await store.revokeAllTokens()).toBe(3);
    expect(await store.validateToken("b")).toBeNull();
    expect(await store.revokeAllTokens()).toBe(0);
  });

  it("carries the granted scope through, so a read token cannot become an exec one", async () => {
    await mint("ro", "read");
    await mint("rw", "exec");
    expect((await store.validateToken("ro"))!.scope).toBe("read");
    expect((await store.validateToken("rw"))!.scope).toBe("exec");
  });

  it("does not lose concurrent token mints", async () => {
    const tokens = Array.from({ length: 16 }, (_, i) => `parallel-${i}`);
    await Promise.all(tokens.map((token) => mint(token)));
    const listed = await store.listTokens();
    expect(listed).toHaveLength(tokens.length);
    for (const token of tokens) expect(await store.validateToken(token)).not.toBeNull();
  });

  it("keeps a token revoked when last-used touches race the kill switch", async () => {
    await mint("tok-race", "exec");
    const live = await store.validateToken("tok-race");
    expect(live).not.toBeNull();
    const id = (await store.listTokens())[0].id;
    const operations = [
      ...Array.from({ length: 16 }, () => store.touchToken(live!.hash)),
      store.revokeToken(id),
    ];
    const results = await Promise.all(operations);
    expect(results.at(-1)).toBe(true);
    expect(await store.validateToken("tok-race")).toBeNull();
  });
});

describe("clients", () => {
  it("mints a distinct client id for every registration even when redirect URIs are identical", async () => {
    const a = await store.registerClient("ChatGPT", ["https://chatgpt.com/connector/oauth/example"]);
    const b = await store.registerClient("ChatGPT", ["https://chatgpt.com/connector/oauth/example"]);
    expect(b).not.toBe(a);
    expect(await store.getClient(a)).toMatchObject({ name: "ChatGPT" });
    expect(await store.getClient(b)).toMatchObject({ name: "ChatGPT" });
  });

  it("reads back a registered client", async () => {
    const id = await store.registerClient("Claude", ["https://claude.ai/cb"]);
    expect(await store.getClient(id)).toMatchObject({ name: "Claude", redirectUris: ["https://claude.ai/cb"] });
    expect(await store.getClient("mcpc_nope")).toBeNull();
  });
});

describe("read()", () => {
  it("throws on a corrupt file instead of silently reporting an empty store", async () => {
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(process.env.OS_MCP_STORE!, "{not json");
    // Same rule as lib/auth/device-store: swallowing this would make the next
    // write erase every issued token AND keep honouring revoked ones.
    await expect(store.listTokens()).rejects.toThrow();
  });

  it("treats a missing file as empty", async () => {
    expect(await store.listTokens()).toEqual([]);
  });
});

describe("OAuth refresh grants", () => {
  it("stores access/refresh only as hashes, rotates refresh once, and keeps resource/profile binding", async () => {
    await store.storeOAuthGrant({
      accessToken: "access-one", refreshToken: "refresh-one", label: "oauth", clientId: "chatgpt-client", scope: "exec",
      resource: "https://mso.example/mcp", profile: "chatgpt", offlineAccess: true, grantId: "grant-one",
    });
    expect(await store.validateToken("access-one")).toMatchObject({ clientId: "chatgpt-client", resource: "https://mso.example/mcp", profile: "chatgpt", grantId: "grant-one" });
    const raw = await fs.readFile(process.env.OS_MCP_STORE!, "utf8");
    expect(raw).not.toContain("access-one");
    expect(raw).not.toContain("refresh-one");
    expect(raw).toContain(sha256hex("refresh-one"));

    const rotated = await store.rotateOAuthGrant({ oldRefreshToken: "refresh-one", accessToken: "access-two", refreshToken: "refresh-two", label: "oauth", clientId: "chatgpt-client", resource: "https://mso.example/mcp" });
    expect(rotated).toMatchObject({ grantId: "grant-one", scope: "exec", offlineAccess: true });
    expect(await store.rotateOAuthGrant({ oldRefreshToken: "refresh-one", accessToken: "replay", refreshToken: "replay-r", label: "oauth", clientId: "chatgpt-client", resource: "https://mso.example/mcp" })).toBeNull();
    expect(await store.validateToken("access-two")).toMatchObject({ grantId: "grant-one", profile: "chatgpt" });
  });

  it("binds refresh to client/resource and revoking one access token kills the grant family", async () => {
    await store.storeOAuthGrant({ accessToken: "family-access", refreshToken: "family-refresh", label: "oauth", clientId: "client-a", scope: "write", resource: "https://mso.example/mcp", grantId: "grant-family" });
    await expect(store.rotateOAuthGrant({ oldRefreshToken: "family-refresh", accessToken: "wrong", refreshToken: "wrong-r", label: "oauth", clientId: "client-b", resource: "https://mso.example/mcp" })).resolves.toBeNull();
    const id = (await store.listTokens()).find((row) => row.grantId === "grant-family")!.id;
    expect(await store.revokeToken(id)).toBe(true);
    await expect(store.rotateOAuthGrant({ oldRefreshToken: "family-refresh", accessToken: "after-revoke", refreshToken: "after-revoke-r", label: "oauth", clientId: "client-a", resource: "https://mso.example/mcp" })).resolves.toBeNull();
  });
});
