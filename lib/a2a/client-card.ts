import type {
  A2AAgentCard,
  A2AAgentInterface,
  A2ADiscoveredAgent,
  A2ASecurityScheme,
} from "./types";
import {
  a2aObject,
  a2aTransport,
  assertA2AUrl,
  fetchA2AJson,
  normalizeA2ABinding,
  type A2AFetchLike,
} from "./client-core";

function cardText(value: unknown, field: string, max = 500): string {
  const out =
    typeof value === "string" ? value.replace(/[\r\n\t]+/g, " ").trim() : "";
  if (!out) throw new Error(`A2A Agent Card is missing ${field}`);
  return [...out].slice(0, max).join("");
}

function cardStrings(value: unknown, max = 100): string[] {
  return Array.isArray(value)
    ? value
        .filter(
          (row): row is string =>
            typeof row === "string" && Boolean(row.trim()),
        )
        .map((row) => row.trim().slice(0, 200))
        .slice(0, max)
    : [];
}

function supportsV1(value: string): boolean {
  return /^1(?:\.|$)/.test(value.trim());
}

function normalizeSecurityScheme(value: unknown): A2ASecurityScheme {
  const row = a2aObject(value);
  const members = [
    "apiKeySecurityScheme",
    "httpAuthSecurityScheme",
    "oauth2SecurityScheme",
    "openIdConnectSecurityScheme",
    "mtlsSecurityScheme",
  ].filter((key) => Object.prototype.hasOwnProperty.call(row, key));
  if (members.length !== 1) return { kind: "unknown" };
  if (members[0] === "apiKeySecurityScheme") {
    const scheme = a2aObject(row.apiKeySecurityScheme);
    const location = String(scheme.location || "").toLowerCase();
    const name =
      typeof scheme.name === "string" ? scheme.name.trim().slice(0, 160) : "";
    if (!name || !["header", "query", "cookie"].includes(location))
      return { kind: "unknown" };
    return {
      kind: "api-key",
      location: location as "header" | "query" | "cookie",
      name,
    };
  }
  if (members[0] === "httpAuthSecurityScheme") {
    const scheme = a2aObject(row.httpAuthSecurityScheme);
    const name =
      typeof scheme.scheme === "string"
        ? scheme.scheme.trim().slice(0, 80)
        : "";
    if (!name) return { kind: "unknown" };
    return {
      kind: "http",
      scheme: name,
      ...(typeof scheme.bearerFormat === "string" && scheme.bearerFormat.trim()
        ? { bearerFormat: scheme.bearerFormat.trim().slice(0, 120) }
        : {}),
    };
  }
  if (members[0] === "oauth2SecurityScheme") return { kind: "oauth2" };
  if (members[0] === "openIdConnectSecurityScheme") {
    const scheme = a2aObject(row.openIdConnectSecurityScheme);
    return {
      kind: "openid",
      ...(typeof scheme.openIdConnectUrl === "string" &&
      scheme.openIdConnectUrl.trim()
        ? { openIdConnectUrl: scheme.openIdConnectUrl.trim().slice(0, 2048) }
        : {}),
    };
  }
  if (members[0] === "mtlsSecurityScheme") return { kind: "mtls" };
  return { kind: "unknown" };
}

export function a2aAgentCardUrl(source: string): string {
  const url = assertA2AUrl(source);
  if (!/\.json$/i.test(url.pathname)) {
    url.pathname = "/.well-known/agent-card.json";
    url.search = "";
  }
  return url.toString();
}

function normalizeInterface(value: unknown): A2AAgentInterface {
  const row = a2aObject(value);
  const url = assertA2AUrl(
    cardText(row.url, "supportedInterfaces[].url", 2048),
  ).toString();
  return {
    url,
    protocolBinding: cardText(
      row.protocolBinding,
      "supportedInterfaces[].protocolBinding",
      160,
    ),
    protocolVersion: cardText(
      row.protocolVersion,
      "supportedInterfaces[].protocolVersion",
      40,
    ),
    ...(typeof row.tenant === "string" && row.tenant.trim()
      ? { tenant: row.tenant.trim().slice(0, 160) }
      : {}),
  };
}

export function normalizeA2AAgentCard(value: unknown): A2AAgentCard {
  const raw = a2aObject(value);
  const interfaces = Array.isArray(raw.supportedInterfaces)
    ? raw.supportedInterfaces.map(normalizeInterface).slice(0, 20)
    : [];
  if (!interfaces.length)
    throw new Error("A2A Agent Card must declare supportedInterfaces");
  const capabilities = Object.fromEntries(
    Object.entries(a2aObject(raw.capabilities))
      .filter(([, item]) => typeof item === "boolean")
      .slice(0, 30),
  ) as Record<string, boolean>;
  const requirementsRaw = Array.isArray(raw.securityRequirements)
    ? raw.securityRequirements
    : Array.isArray(raw.security)
      ? raw.security
      : [];
  const securityRequirements = requirementsRaw.slice(0, 20).map((entry) => {
    const row = a2aObject(entry);
    // A2A v1 wraps requirement entries in { schemes: { <name>: StringList } }.
    // Accept the older direct-map draft shape as a compatibility input, but
    // normalize everything to the v1 wrapper.
    const source = Object.prototype.hasOwnProperty.call(row, "schemes")
      ? a2aObject(row.schemes)
      : row;
    const schemes = Object.fromEntries(
      Object.keys(source)
        .filter((key) => /^[A-Za-z0-9._-]{1,120}$/.test(key))
        .slice(0, 20)
        .map((key) => [key, { list: [] }]),
    );
    return { schemes };
  });
  const requiresAuthentication =
    securityRequirements.length > 0 &&
    !securityRequirements.some(
      (row) => Object.keys(a2aObject(row.schemes)).length === 0,
    );
  const securitySchemes = Object.fromEntries(
    Object.entries(a2aObject(raw.securitySchemes))
      .filter(([name]) => /^[A-Za-z0-9._-]{1,120}$/.test(name))
      .slice(0, 30)
      .map(([name, scheme]) => [name, normalizeSecurityScheme(scheme)]),
  ) as Record<string, A2ASecurityScheme>;
  const skills = (Array.isArray(raw.skills) ? raw.skills : [])
    .slice(0, 200)
    .map((entry) => {
      const row = a2aObject(entry);
      return {
        id: cardText(row.id, "skills[].id", 160),
        name: cardText(row.name, "skills[].name", 160),
        description: cardText(row.description, "skills[].description", 600),
        tags: cardStrings(row.tags, 30),
        inputModes: cardStrings(row.inputModes, 30),
        outputModes: cardStrings(row.outputModes, 30),
      };
    });
  return {
    name: cardText(raw.name, "name", 160),
    description: cardText(raw.description, "description", 1000),
    version: cardText(raw.version, "version", 80),
    supportedInterfaces: interfaces,
    capabilities,
    defaultInputModes: cardStrings(raw.defaultInputModes, 30),
    defaultOutputModes: cardStrings(raw.defaultOutputModes, 30),
    skills,
    securityRequirements,
    securitySchemes,
    securitySchemeNames: Object.keys(securitySchemes),
    requiresAuthentication,
  };
}

export function selectA2AInterface(card: A2AAgentCard): A2AAgentInterface {
  const selected = card.supportedInterfaces.find(
    (row) =>
      supportsV1(row.protocolVersion) &&
      normalizeA2ABinding(row.protocolBinding),
  );
  if (!selected) {
    const advertised = card.supportedInterfaces
      .map((row) => `${row.protocolBinding}@${row.protocolVersion}`)
      .join(", ");
    throw new Error(
      `A2A agent has no supported v1 JSONRPC or HTTP+JSON interface${advertised ? `; advertised: ${advertised}` : ""}`,
    );
  }
  return selected;
}

export async function discoverA2AAgent(
  source: string,
  fetchImpl: A2AFetchLike = a2aTransport,
): Promise<A2ADiscoveredAgent> {
  const cardUrl = a2aAgentCardUrl(source);
  const raw = await fetchA2AJson(
    cardUrl,
    { headers: { accept: "application/a2a+json, application/json" } },
    fetchImpl,
  );
  const card = normalizeA2AAgentCard(raw);
  return { cardUrl, card, selectedInterface: selectA2AInterface(card) };
}
