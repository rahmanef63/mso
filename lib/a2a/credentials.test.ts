import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = mkdtempSync(path.join(os.tmpdir(), "mso-a2a-creds-"));
process.env.OS_A2A_CREDENTIAL_STORE = path.join(root, "outbound.json");
process.env.OS_A2A_INBOUND_TOKEN_STORE = path.join(root, "inbound.json");
const creds = await import("./credentials");

beforeAll(() => {});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("A2A credential stores", () => {
  it("stores outbound secrets privately but only returns summaries", async () => {
    const created = await creds.createA2AOutboundCredential({
      agentId: "peer1",
      label: "prod",
      kind: "bearer",
      secret: "secret-value",
    });
    expect(created).not.toHaveProperty("secret");
    expect(await creds.a2aCredentialHeaders(created.id)).toEqual({
      authorization: "Bearer secret-value",
    });
    const disk = readFileSync(process.env.OS_A2A_CREDENTIAL_STORE!, "utf8");
    expect(disk).toContain("secret-value");
    expect(statSync(process.env.OS_A2A_CREDENTIAL_STORE!).mode & 0o077).toBe(0);
  });

  it("supports API-key headers and rejects dangerous header names", async () => {
    const api = await creds.createA2AOutboundCredential({
      agentId: "peer1",
      label: "api",
      kind: "api-key",
      secret: "abc",
      headerName: "X-Agent-Key",
    });
    expect(await creds.a2aCredentialHeaders(api.id)).toEqual({
      "X-Agent-Key": "abc",
    });
    await expect(
      creds.createA2AOutboundCredential({
        agentId: "peer1",
        label: "bad",
        kind: "api-key",
        secret: "abc",
        headerName: "Cookie",
      }),
    ).rejects.toThrow(/not allowed/);
  });

  it("hashes inbound bearer tokens and returns the raw token only at mint", async () => {
    const created = await creds.createA2AInboundToken("researcher", "write");
    expect(created.token).toMatch(/^mso_a2a_/);
    expect(created.profile.scope).toBe("write");
    const disk = readFileSync(process.env.OS_A2A_INBOUND_TOKEN_STORE!, "utf8");
    expect(disk).not.toContain(created.token);
    expect(await creds.authenticateA2AInboundToken(created.token)).toEqual(
      created.profile,
    );
    expect(
      await creds.authenticateA2AInboundToken(`${created.token}x`),
    ).toBeNull();
  });
});
