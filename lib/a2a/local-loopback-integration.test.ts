import { afterAll, describe, expect, it } from "vitest";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = mkdtempSync(path.join(os.tmpdir(), "mso-a2a-loopback-e2e-"));
process.env.OS_A2A_ALLOW_LOOPBACK = "1";
process.env.OS_A2A_STORE = path.join(root, "agents.json");
process.env.OS_A2A_LOCAL_AUTH_STORE = path.join(root, "local-auth.json");
process.env.NEXT_PUBLIC_OS_DEMO = "0";

const seen = { method: "", authorization: "" };
let origin = "";
const server = http.createServer(async (req, res) => {
  if (
    req.method === "GET" &&
    req.url?.startsWith("/.well-known/agent-card.json")
  ) {
    const session =
      new URL(req.url, origin).searchParams.get("session") || "bece";
    res.setHeader("content-type", "application/a2a+json");
    res.end(
      JSON.stringify({
        name: `MSO · ${session}`,
        description: "same-host fixture session",
        version: "1.0.0",
        supportedInterfaces: [
          {
            url: `${origin}/a2a/v1?session=${encodeURIComponent(session)}`,
            protocolBinding: "JSONRPC",
            protocolVersion: "1.0",
          },
        ],
        capabilities: { streaming: true },
        securitySchemes: {
          msoLocal: {
            httpAuthSecurityScheme: {
              scheme: "Bearer",
              bearerFormat: "MSO-LOCAL-A2A",
            },
          },
        },
        securityRequirements: [{ schemes: { msoLocal: { list: [] } } }],
        defaultInputModes: ["text/plain"],
        defaultOutputModes: ["text/plain"],
        skills: [
          {
            id: "session",
            name: session,
            description: "local session",
            tags: ["local"],
            inputModes: ["text/plain"],
            outputModes: ["text/plain"],
          },
        ],
      }),
    );
    return;
  }
  if (req.method === "POST" && req.url?.startsWith("/a2a/v1")) {
    seen.authorization = String(req.headers.authorization || "");
    let raw = "";
    for await (const chunk of req) raw += String(chunk);
    const body = JSON.parse(raw);
    seen.method = body.method;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          task: {
            id: "fixture-task",
            contextId: "fixture-context",
            status: { state: "TASK_STATE_COMPLETED" },
            artifacts: [
              {
                artifactId: "fixture-result",
                name: "result",
                parts: [
                  { text: "loopback handoff ok", mediaType: "text/plain" },
                ],
              },
            ],
          },
        },
      }),
    );
    return;
  }
  res.statusCode = 404;
  res.end("not found");
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string")
  throw new Error("fixture server did not bind");
origin = `http://127.0.0.1:${address.port}`;
process.env.OS_A2A_LOOPBACK_ORIGIN = origin;

const { handoffA2A } = await import("./handoff");
const { registerA2AAgent, resolveA2AAgent } = await import("./store");

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  rmSync(root, { recursive: true, force: true });
});

describe("registered same-host A2A over exact loopback", () => {
  it("discovers/registers a virtual session card and handoffs without a manual credential", async () => {
    const cardUrl = `${origin}/.well-known/agent-card.json?session=bece`;
    const registered = await registerA2AAgent(cardUrl, "bece");
    expect(registered.alias).toBe("bece");
    expect(registered.cardUrl).toBe(cardUrl);
    expect(registered.credentialProfileId).toBeUndefined();

    const agent = await resolveA2AAgent("bece");
    const result = await handoffA2A(
      agent,
      "review the current work",
      undefined,
      {
        returnImmediately: false,
      },
    );
    expect(seen.method).toBe("SendMessage");
    expect(seen.authorization).toMatch(/^Bearer mso_local_a2a_/);
    expect(result.response).toMatchObject({
      task: {
        status: { state: "TASK_STATE_COMPLETED" },
      },
    });
  });
});
