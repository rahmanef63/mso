import { directConnectionValues, resolveIntegration } from "./connection-service";
import { composioAuthHeader, COMPOSIO_API_BASE } from "./composio";
import { request, obj } from "./http";
import { identity, metadataOnly, IntegrationError } from "./identity";
import { rateLimited } from "@/lib/host/limits-api";

export async function queryComposioInventory(input: Record<string, unknown>) {
  metadataOnly(input);
  if (Object.keys(input).some(key => !["view", "user", "provider", "connection", "cursor"].includes(key)))
    throw new IntegrationError("invalid_query_fields");
  if (input.provider !== "composio") throw new IntegrationError("provider_operation_mismatch");
  const user = identity(input.user, "user"), connection = identity(input.connection, "connection");
  const cursor = input.cursor;
  if (cursor !== undefined && (typeof cursor !== "string" || !cursor || cursor.length > 1024 || /[\x00-\x1f\x7f]/.test(cursor)))
    throw new IntegrationError("invalid_composio_cursor");
  const selection = { user, connection };
  const route = await resolveIntegration("composio", selection);
  const values = await directConnectionValues("composio", selection);
  let auth;
  try { auth = composioAuthHeader(values); }
  catch { throw new IntegrationError("composio_platform_key_required", 409); }
  if (!auth || auth.kind === "organization") throw new IntegrationError("composio_project_key_required", 409);
  if (rateLimited(`composio.inventory:${user}:${connection}`, 20, 60_000)) throw new IntegrationError("rate_limited", 429);
  const url = new URL(`${COMPOSIO_API_BASE}/connected_accounts`);
  url.searchParams.set("limit", "50");
  if (typeof cursor === "string") url.searchParams.set("cursor", cursor);
  let response;
  try { response = await request(url.href, { method: "GET", headers: { ...auth.header, accept: "application/json" } }); }
  catch { throw new IntegrationError("composio_inventory_unreachable", 502); }
  if (!response.ok) throw new IntegrationError(`composio_http_${response.status}`, response.status === 401 || response.status === 403 ? 401 : 502);
  const body = obj(response.body);
  if (!Array.isArray(body.items) || body.items.length > 50) throw new IntegrationError("invalid_composio_inventory", 502);
  const secrets = [values.apiKey, values.orgApiKey].filter((value): value is string => Boolean(value));
  const safe = (value: unknown): string | null => typeof value === "string" && value.length <= 1024
    ? secrets.reduce((text, secret) => text.split(secret).join("[redacted]"), value) : null;
  const accounts = body.items.map(value => {
    const row = obj(value), id = safe(row.id);
    if (!id) throw new IntegrationError("invalid_composio_inventory", 502);
    return { id, toolkit: safe(obj(row.toolkit).slug), status: safe(row.status), authConfigId: safe(obj(row.auth_config).id), userId: safe(row.user_id) };
  });
  const nextCursor = body.next_cursor == null ? null : safe(body.next_cursor);
  if ((body.next_cursor != null && !nextCursor) || (body.has_more === true && !nextCursor))
    throw new IntegrationError("invalid_composio_inventory", 502);
  const current = await resolveIntegration("composio", selection);
  if (current.revision !== route.revision) throw new IntegrationError("connection_changed", 409);
  return { user, provider: "composio", connection, revision: route.revision, accounts, nextCursor, complete: nextCursor === null };
}
