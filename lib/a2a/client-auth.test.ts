import { describe, expect, it, vi } from "vitest";

const mockHeaders = vi.hoisted(() =>
  vi.fn(async () => ({ authorization: "Bearer peer-secret" })),
);
const mockProfile = vi.hoisted(() =>
  vi.fn(async () => ({
    id: "cred-1",
    agentId: "peer-1",
    label: "prod",
    kind: "bearer",
  })),
);
vi.mock("./credentials", () => ({
  a2aCredentialHeaders: mockHeaders,
  getA2AOutboundCredential: mockProfile,
}));
const { sendA2AMessage, sendA2AStreamingMessage } = await import("./client");

const target = {
  cardUrl: "https://agent.example/.well-known/agent-card.json",
  card: {
    name: "Peer",
    description: "peer",
    version: "1",
    capabilities: { streaming: true },
    supportedInterfaces: [
      {
        url: "https://agent.example/a2a",
        protocolBinding: "JSONRPC",
        protocolVersion: "1.0",
      },
    ],
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: [],
    securityRequirements: [{ schemes: { bearer: { list: [] } } }],
    securitySchemeNames: ["bearer"],
    requiresAuthentication: true,
  },
  selectedInterface: {
    url: "https://agent.example/a2a",
    protocolBinding: "JSONRPC",
    protocolVersion: "1.0",
  },
  credentialProfileId: "cred-1",
};

describe("authenticated A2A client", () => {
  it("applies the local credential at the HTTP transport layer", async () => {
    let authorization = "";
    await sendA2AMessage(target, "work", {}, async (_input, init) => {
      authorization = new Headers(init?.headers).get("authorization") || "";
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "x",
          result: { task: { id: "t" } },
        }),
        { headers: { "content-type": "application/json" } },
      );
    });
    expect(authorization).toBe("Bearer peer-secret");
    expect(mockHeaders).toHaveBeenCalledWith("cred-1");
  });

  it("parses v1 SendStreamingMessage SSE envelopes", async () => {
    const calls: string[] = [];
    const fetcher = async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      calls.push(body.method);
      const payload = [
        `data: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { task: { id: "t1" } } })}\n\n`,
        `data: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { statusUpdate: { taskId: "t1" } } })}\n\n`,
      ].join("");
      return new Response(payload, {
        headers: { "content-type": "text/event-stream" },
      });
    };
    const events = [];
    for await (const event of sendA2AStreamingMessage(
      target,
      "stream",
      {},
      fetcher,
    ))
      events.push(event);
    expect(calls).toEqual(["SendStreamingMessage"]);
    expect(events).toEqual([
      { task: { id: "t1" } },
      { statusUpdate: { taskId: "t1" } },
    ]);
  });
  it("fails closed when a requirement needs multiple simultaneous schemes", async () => {
    const multi = {
      ...target,
      card: {
        ...target.card,
        securityRequirements: [
          { schemes: { bearer: { list: [] }, api: { list: [] } } },
        ],
        securitySchemeNames: ["bearer", "api"],
      },
    };
    await expect(sendA2AMessage(multi, "work")).rejects.toThrow(
      /multiple simultaneous security schemes/,
    );
  });

  it("requires an explicit profile scheme when the card offers multiple alternatives", async () => {
    const alternatives = {
      ...target,
      card: {
        ...target.card,
        securityRequirements: [
          { schemes: { bearer: { list: [] } } },
          { schemes: { api: { list: [] } } },
        ],
        securitySchemeNames: ["bearer", "api"],
      },
    };
    await expect(sendA2AMessage(alternatives, "work")).rejects.toThrow(
      /select a security scheme/,
    );
  });
});
