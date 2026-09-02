import { describe, expect, it } from "vitest";
import { normalizeA2AAgentCard } from "./client";
import { resolveA2ACredentialBinding } from "./credential-scheme";

function card(
  securitySchemes: Record<string, unknown>,
  securityRequirements: unknown[],
) {
  return normalizeA2AAgentCard({
    name: "Peer",
    description: "peer",
    version: "1.0",
    supportedInterfaces: [
      {
        url: "https://peer.example/a2a",
        protocolBinding: "JSONRPC",
        protocolVersion: "1.0",
      },
    ],
    capabilities: {},
    securitySchemes,
    securityRequirements,
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: [],
  });
}

describe("A2A credential scheme binding", () => {
  it("normalizes v1 security metadata and infers the Agent Card API-key header", () => {
    const secured = card(
      {
        api: {
          apiKeySecurityScheme: { location: "header", name: "X-Agent-Key" },
        },
      },
      [{ schemes: { api: { list: [] } } }],
    );
    expect(secured.securitySchemes?.api).toEqual({
      kind: "api-key",
      location: "header",
      name: "X-Agent-Key",
    });
    expect(resolveA2ACredentialBinding(secured, { kind: "api-key" })).toEqual({
      schemeName: "api",
      headerName: "X-Agent-Key",
    });
  });

  it("fails closed for API keys outside HTTP headers", () => {
    const secured = card(
      {
        api: {
          apiKeySecurityScheme: { location: "query", name: "api_key" },
        },
      },
      [{ schemes: { api: { list: [] } } }],
    );
    expect(() =>
      resolveA2ACredentialBinding(secured, { kind: "api-key" }),
    ).toThrow(/header API keys only/);
  });

  it("accepts HTTP Bearer and rejects unsupported HTTP Basic", () => {
    const bearer = card(
      { auth: { httpAuthSecurityScheme: { scheme: "Bearer" } } },
      [{ schemes: { auth: { list: [] } } }],
    );
    expect(resolveA2ACredentialBinding(bearer, { kind: "bearer" })).toEqual({
      schemeName: "auth",
    });
    const basic = card(
      { auth: { httpAuthSecurityScheme: { scheme: "Basic" } } },
      [{ schemes: { auth: { list: [] } } }],
    );
    expect(() =>
      resolveA2ACredentialBinding(basic, { kind: "bearer" }),
    ).toThrow(/Basic is not supported/);
  });

  it("requires OAuth access-token profiles for OAuth2/OIDC and rejects mTLS", () => {
    const oauth = card({ oauth: { oauth2SecurityScheme: { flows: {} } } }, [
      { schemes: { oauth: { list: [] } } },
    ]);
    expect(resolveA2ACredentialBinding(oauth, { kind: "oauth2" })).toEqual({
      schemeName: "oauth",
    });
    expect(() =>
      resolveA2ACredentialBinding(oauth, { kind: "bearer" }),
    ).toThrow(/oauth2 access-token profile/);
    const mtls = card({ mtls: { mtlsSecurityScheme: {} } }, [
      { schemes: { mtls: { list: [] } } },
    ]);
    expect(() => resolveA2ACredentialBinding(mtls, { kind: "bearer" })).toThrow(
      /mTLS.*not supported/,
    );
  });
});
