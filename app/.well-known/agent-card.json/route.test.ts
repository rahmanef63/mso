import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_OS_DEMO", "0");
  vi.stubEnv("OS_A2A_INBOUND_ENABLED", "1");
  vi.stubEnv("OS_PUBLIC_ORIGIN", "https://mso.hub.acme.org");
});

describe("GET /.well-known/agent-card.json", () => {
  it("serves agent card without a session or auth headers (public-by-design)", async () => {
    // A2A discovery: peer agents probe the card without prior credentials
    const req = new Request("https://mso.hub.acme.org/.well-known/agent-card.json");
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/a2a+json; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");

    const body = await res.json();
    expect(body).toEqual({
      name: "MSO Agent",
      description: "Authenticated Manef Shell OS agent. Each bearer credential is capability-scoped by the owner.",
      version: "1.0.0",
      supportedInterfaces: [
        {
          url: "https://mso.hub.acme.org/a2a/v1",
          protocolBinding: "JSONRPC",
          protocolVersion: "1.0",
        },
      ],
      capabilities: {
        streaming: true,
        pushNotifications: false,
        extendedAgentCard: false,
      },
      securitySchemes: {
        msoBearer: {
          httpAuthSecurityScheme: {
            scheme: "Bearer",
            bearerFormat: "MSO-A2A",
          },
        },
      },
      securityRequirements: [
        {
          schemes: {
            msoBearer: { list: [] },
          },
        },
      ],
      defaultInputModes: ["text/plain"],
      defaultOutputModes: ["text/plain", "application/json"],
      skills: [
        {
          id: "mso-agent",
          name: "MSO Agent",
          description:
            "Inspect or operate this MSO host within the exact read/write/exec capability granted to the inbound credential.",
          tags: ["mso", "operations", "agent"],
          inputModes: ["text/plain"],
          outputModes: ["text/plain", "application/json"],
        },
      ],
    });
  });

  it("derives interface URL from configured origin, not a hardcoded host", async () => {
    vi.stubEnv("OS_PUBLIC_ORIGIN", "https://peer.dynamic.org");
    const req = new Request("https://peer.dynamic.org/.well-known/agent-card.json");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.supportedInterfaces[0].url).toBe("https://peer.dynamic.org/a2a/v1");
  });

  it("refuses external enumeration of internal session cards with 404", async () => {
    // Probing private session references over a non-loopback origin must be refused
    const req = new Request("https://mso.hub.acme.org/.well-known/agent-card.json?session=private-session");
    const res = await GET(req);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("returns 404 when inbound A2A is disabled", async () => {
    vi.stubEnv("OS_A2A_INBOUND_ENABLED", "0");
    vi.stubEnv("OS_A2A_ALLOW_LOOPBACK", "0");
    const req = new Request("https://mso.hub.acme.org/.well-known/agent-card.json");
    const res = await GET(req);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});
