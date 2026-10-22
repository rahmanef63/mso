import type { InfraProviderValues } from "./types";
import { readInfraProvider } from "./store";
import { request } from "./http";

export const COMPOSIO_API_BASE = "https://backend.composio.dev/api/v3.1";
const API = COMPOSIO_API_BASE;

/**
 * Composio keys live on two different products. Platform keys (ak_ project,
 * uak_ user from `composio login`, org keys) authenticate against
 * backend.composio.dev/api/v3.1. A ck_ Connect consumer key belongs to the
 * Connect MCP product at connect.composio.dev/mcp: it works for Connect tool
 * access (`composio.tools.list` / `composio.tool` through lib/infra/composio-connect.ts)
 * and it cannot authorize Platform connected accounts, which stay on the three
 * Platform header kinds below.
 */
export function composioConnectKey(value: string | undefined): boolean {
  return Boolean(value?.trim().startsWith("ck_"));
}

export const COMPOSIO_CONNECT_KEY_MESSAGE =
  "Composio Connect key (ck_…). A Connect key works for Composio Connect tool access and cannot authorize Platform connected accounts. Platform keys start ak_ (project) or uak_ (user).";

export function composioAuthHeader(values: InfraProviderValues): { header: Record<string, string>; kind: "organization" | "user" | "project" } | null {
  const orgKey = values.orgApiKey?.trim();
  if (composioConnectKey(orgKey)) throw new Error(COMPOSIO_CONNECT_KEY_MESSAGE);
  if (orgKey) return { header: { "x-org-api-key": orgKey }, kind: "organization" };
  const key = values.apiKey?.trim();
  if (!key) return null;
  if (composioConnectKey(key)) throw new Error(COMPOSIO_CONNECT_KEY_MESSAGE);
  if (key.startsWith("uak_")) return { header: { "x-user-api-key": key }, kind: "user" };
  return { header: { "x-api-key": key }, kind: "project" };
}

/** Which Platform key kind is stored. Safe for a UI: it never touches the key value. */
export function composioKeyKind(values: InfraProviderValues): "organization" | "user" | "project" | "connect" | null {
  if (composioConnectKey(values.orgApiKey) || composioConnectKey(values.apiKey)) return "connect";
  if (values.orgApiKey?.trim()) return "organization";
  const key = values.apiKey?.trim();
  if (!key) return null;
  return key.startsWith("uak_") ? "user" : "project";
}

export async function doctorComposio(candidate?: InfraProviderValues): Promise<string | null> {
  const values = candidate ?? await readInfraProvider("composio");
  const auth = composioAuthHeader(values);
  if (!auth) return null;
  // Session-info proves the key kind and works for all three kinds; tool listing
  // additionally proves project reach for keys that carry it.
  const target = auth.kind === "organization" ? "/org/owner/project/list" : auth.kind === "user" ? "/auth/session/info" : "/tools?limit=1";
  const response = await request(`${API}${target}`, { headers: auth.header });
  if (response.status === 401 || response.status === 403) {
    throw new Error(`Composio rejected this ${auth.kind} key (${response.status})`);
  }
  if (!response.ok) throw new Error(`Composio validation failed (${response.status})`);
  return auth.kind === "organization"
    ? "Composio organization key accepted"
    : auth.kind === "user"
      ? "Composio user key accepted"
      : "Composio project key accepted";
}
