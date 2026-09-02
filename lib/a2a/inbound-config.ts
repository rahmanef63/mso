import { IS_DEMO } from "@/lib/demo";
import type { AgentSession } from "@/lib/agent/session-types";
import {
  a2aLoopbackEnabled,
  a2aLoopbackOrigin,
  isA2ALoopbackUrl,
} from "./network";

export type A2AInboundConfig = {
  enabled: boolean;
  origin: string | null;
  cardUrl: string | null;
  protocolUrl: string | null;
  publicOrigin: string | null;
  loopbackOrigin: string | null;
  reason?: string;
};

function publicOrigin(): { origin: string | null; reason?: string } {
  const raw = process.env.OS_PUBLIC_ORIGIN?.trim();
  if (!raw) return { origin: null };
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:")
      return { origin: null, reason: "https_required" };
    return { origin: url.origin };
  } catch {
    return { origin: null, reason: "invalid_public_origin" };
  }
}

export function a2aInboundConfig(): A2AInboundConfig {
  if (IS_DEMO)
    return {
      enabled: false,
      origin: null,
      cardUrl: null,
      protocolUrl: null,
      publicOrigin: null,
      loopbackOrigin: null,
      reason: "demo_mode",
    };

  const publicEnabled = process.env.OS_A2A_INBOUND_ENABLED !== "0";
  const localEnabled = a2aLoopbackEnabled();
  if (!publicEnabled && !localEnabled)
    return {
      enabled: false,
      origin: null,
      cardUrl: null,
      protocolUrl: null,
      publicOrigin: null,
      loopbackOrigin: null,
      reason: "disabled",
    };

  const published = publicEnabled ? publicOrigin() : { origin: null };
  let loopback: string | null = null;
  if (localEnabled) {
    try {
      loopback = a2aLoopbackOrigin();
    } catch {
      return {
        enabled: false,
        origin: null,
        cardUrl: null,
        protocolUrl: null,
        publicOrigin: published.origin,
        loopbackOrigin: null,
        reason: "invalid_loopback_origin",
      };
    }
  }

  const origin = published.origin || loopback;
  if (!origin)
    return {
      enabled: false,
      origin: null,
      cardUrl: null,
      protocolUrl: null,
      publicOrigin: null,
      loopbackOrigin: null,
      reason: published.reason || "public_origin_required",
    };
  return {
    enabled: true,
    origin,
    cardUrl: `${origin}/.well-known/agent-card.json`,
    protocolUrl: `${origin}/a2a/v1`,
    publicOrigin: published.origin,
    loopbackOrigin: loopback,
  };
}

export function assertA2AInboundEnabled(): A2AInboundConfig & {
  enabled: true;
  origin: string;
  cardUrl: string;
  protocolUrl: string;
} {
  const config = a2aInboundConfig();
  if (
    !config.enabled ||
    !config.origin ||
    !config.cardUrl ||
    !config.protocolUrl
  )
    throw new Error(
      `A2A inbound is unavailable: ${config.reason || "disabled"}`,
    );
  return config as A2AInboundConfig & {
    enabled: true;
    origin: string;
    cardUrl: string;
    protocolUrl: string;
  };
}

export function a2aInboundOriginForRequest(requestUrl: string): string | null {
  const config = a2aInboundConfig();
  if (!config.enabled) return null;
  let request: URL;
  try {
    request = new URL(requestUrl);
  } catch {
    return null;
  }
  if (config.loopbackOrigin && isA2ALoopbackUrl(request)) {
    const expected = new URL(config.loopbackOrigin);
    if ((request.port || "80") === (expected.port || "80"))
      return expected.origin;
  }
  return config.publicOrigin;
}

export function inboundAgentCard(
  options: {
    origin?: string;
    session?: AgentSession | null;
    local?: boolean;
  } = {},
) {
  const config = assertA2AInboundEnabled();
  const origin = options.origin || config.origin;
  const local = options.local ?? isA2ALoopbackUrl(origin);
  const session = options.session || null;
  const protocol = new URL(`${origin}/a2a/v1`);
  if (session?.id) protocol.searchParams.set("session", session.id);
  const schemeName = local ? "msoLocal" : "msoBearer";
  const bearerFormat = local ? "MSO-LOCAL-A2A" : "MSO-A2A";
  return {
    name: session ? `MSO · ${session.title}` : "MSO Agent",
    description: session
      ? "Same-host virtual MSO agent backed by one durable terminal AI session."
      : "Authenticated Manef Shell OS agent. Each bearer credential is capability-scoped by the owner.",
    version: "1.0.0",
    supportedInterfaces: [
      {
        url: protocol.toString(),
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
      [schemeName]: {
        httpAuthSecurityScheme: { scheme: "Bearer", bearerFormat },
      },
    },
    securityRequirements: [{ schemes: { [schemeName]: { list: [] } } }],
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain", "application/json"],
    skills: [
      {
        id: session ? "mso-local-session" : "mso-agent",
        name: session ? session.title : "MSO Agent",
        description: session
          ? "Delegate work into this durable MSO terminal session context."
          : "Inspect or operate this MSO host within the exact read/write/exec capability granted to the inbound credential.",
        tags: session
          ? ["mso", "session", "local-a2a"]
          : ["mso", "operations", "agent"],
        inputModes: ["text/plain"],
        outputModes: ["text/plain", "application/json"],
      },
    ],
  };
}
