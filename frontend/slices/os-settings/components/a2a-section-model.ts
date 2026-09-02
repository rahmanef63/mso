export type A2AAgentRow = {
  id: string;
  alias: string;
  credentialProfileId?: string;
  card: {
    name: string;
    version: string;
    requiresAuthentication: boolean;
    securitySchemeNames?: string[];
    securitySchemes?: Record<
      string,
      | {
          kind: "api-key";
          location: "header" | "query" | "cookie";
          name: string;
        }
      | { kind: "http"; scheme: string }
      | { kind: "oauth2" }
      | { kind: "openid" }
      | { kind: "mtls" }
      | { kind: "unknown" }
    >;
    capabilities?: Record<string, boolean>;
  };
};

export type A2ACredentialRow = {
  id: string;
  agentId: string;
  label: string;
  kind: "api-key" | "bearer" | "oauth2";
  schemeName?: string;
  headerName?: string;
  expiresAt?: string;
};

export type A2AInboundTokenRow = {
  id: string;
  label: string;
  scope: "read" | "write" | "exec";
  createdAt: string;
};

export type A2ATaskRow = {
  id: string;
  principal: string;
  scope: string;
  active?: boolean;
  status: { state: string; timestamp: string };
  updatedAt: string;
};

export type A2AAuditRow = {
  id?: string;
  ts?: string;
  action?: string;
  actor?: string;
  target?: string;
  ok?: boolean;
  detail?: string;
};

export type A2ASettingsState = {
  inbound: {
    enabled: boolean;
    origin: string | null;
    cardUrl: string | null;
    protocolUrl: string | null;
    reason?: string;
  };
  agents: A2AAgentRow[];
  credentials: A2ACredentialRow[];
  inboundTokens: A2AInboundTokenRow[];
  tasks: A2ATaskRow[];
  activity: A2AAuditRow[];
};

export type A2AAction = (
  body: Record<string, unknown>,
  success: string,
) => Promise<Record<string, unknown> | null>;

export async function postA2A(body: Record<string, unknown>) {
  const response = await fetch("/api/v1/a2a", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok)
    throw new Error(
      typeof data.error === "string" ? data.error : `HTTP ${response.status}`,
    );
  return data;
}

export const a2aTaskLabel = (state: string) =>
  state
    .replace(/^TASK_STATE_/, "")
    .replaceAll("_", " ")
    .toLowerCase();

export const shortA2AId = (value: string) =>
  value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
