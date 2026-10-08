import { afterAll, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(os.tmpdir(), "mso-a2a-security-"));
process.env.OS_A2A_CREDENTIAL_STORE = path.join(root, "credentials.json");
process.env.OS_A2A_ALLOW_LOOPBACK = "1";
const { createA2AOutboundCredential } = await import("./credentials-outbound");
const { discoverA2AAgent, getA2ATask } = await import("./client");
const { sendA2AStreamingMessage } = await import("./client-stream");
const card = (url = "https://peer.example/a2a") => ({ name: "Peer", description: "peer", version: "1.0", supportedInterfaces: [{ url, protocolBinding: "JSONRPC", protocolVersion: "1.0" }], capabilities: { streaming: true }, securitySchemes: { bearer: { httpAuthSecurityScheme: { scheme: "bearer" } } }, securityRequirements: [{ schemes: { bearer: { list: [] } } }], defaultInputModes: ["text/plain"], defaultOutputModes: ["text/plain"], skills: [] });
afterAll(async () => { delete process.env.OS_A2A_CREDENTIAL_STORE; delete process.env.OS_A2A_ALLOW_LOOPBACK; await rm(root, { recursive: true, force: true }); });

it("blocks read/write loopback before discovery and after a public card selects it", async () => {
  const fetch = vi.fn(async () => Response.json(card("http://127.0.0.1:3000/a2a/v1")));
  for (const scope of ["read", "write"] as const) {
    await expect(discoverA2AAgent("http://127.0.0.1:3000/", fetch, scope)).rejects.toThrow("exec authority");
    expect(fetch).not.toHaveBeenCalled();
    await expect(discoverA2AAgent("https://peer.example", fetch, scope)).rejects.toThrow("exec authority");
    fetch.mockClear();
  }
});

it("redacts the actual outbound secret from nested task results, protocol errors and SSE", async () => {
  const peer = await discoverA2AAgent("https://peer.example", async () => Response.json(card()));
  const secret = "arbitrary-outbound-secret-7940";
  const profile = await createA2AOutboundCredential({ agentId: "agent_peer", label: "Peer", kind: "bearer", secret, schemeName: "bearer" });
  const target = { ...peer, credentialProfileId: profile.id };
  const result = await getA2ATask(target, "task", 10, async (_url, init) => {
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${secret}`);
    return Response.json({ result: { nested: [secret, { [secret]: `Bearer ${secret}` }] } });
  });
  expect(JSON.stringify(result)).not.toContain(secret);
  await expect(getA2ATask(target, "task", 10, async () => Response.json({ error: { message: secret } }))).rejects.toThrow("[redacted]");
  const events: unknown[] = [];
  for await (const value of sendA2AStreamingMessage(target, "hello", {}, async () => new Response(`data: ${JSON.stringify({ result: { text: secret } })}\n\n`, { headers: { "content-type": "text/event-stream" } }))) events.push(value);
  expect(JSON.stringify(events)).not.toContain(secret);
  const stream = sendA2AStreamingMessage(target, "hello", {}, async () => { throw new Error(secret); });
  await expect(stream.next()).rejects.toThrow("[redacted]");
});
