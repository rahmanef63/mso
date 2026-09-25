import { IntegrationError } from "./identity";
import type { GoogleProvider } from "./google-native-types";
import { GOOGLE_READ_OPERATIONS } from "./google-api-catalog";
import { keys, text, integer, dates, property, inspection, named, enumeration } from "./google-api-input";
export { GOOGLE_READ_OPERATIONS } from "./google-api-catalog";
const SITE = "https://www.googleapis.com/webmasters/v3/sites";
const MAX_RESPONSE = 2 * 1024 * 1024;
function target(operation: string, args: Record<string, unknown>): { url: string; body?: unknown } {
  switch (operation) {
    case "google.searchConsole.sites.list": keys(args, []); return { url: SITE };
    case "google.searchConsole.sitemaps.list": keys(args, ["siteUrl"]); return { url: `${SITE}/${encodeURIComponent(property(args.siteUrl))}/sitemaps` };
    case "google.searchConsole.searchAnalytics.query": {
      keys(args, ["siteUrl", "startDate", "endDate", "dimensions", "type", "rowLimit", "startRow"]);
      const dimensions = args.dimensions ?? ["query"];
      if (!Array.isArray(dimensions) || dimensions.length > 5 || new Set(dimensions).size !== dimensions.length) throw new IntegrationError("invalid_google_arguments");
      dimensions.forEach(d => enumeration(d, ["date", "query", "page", "country", "device", "searchAppearance"]));
      return { url: `${SITE}/${encodeURIComponent(property(args.siteUrl))}/searchAnalytics/query`, body: { ...dates(args.startDate, args.endDate), dimensions,
        type: enumeration(args.type ?? "web", ["web", "image", "video", "news", "discover", "googleNews"]), rowLimit: integer(args.rowLimit ?? 100, 1, 1000), startRow: integer(args.startRow ?? 0, 0, 100000) } };
    }
    case "google.searchConsole.url.inspect": {
      keys(args, ["siteUrl", "inspectionUrl", "languageCode"]); const siteUrl = property(args.siteUrl), languageCode = text(args.languageCode ?? "en-US", 35);
      if (!/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(languageCode)) throw new IntegrationError("invalid_google_arguments");
      return { url: "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", body: { siteUrl, inspectionUrl: inspection(siteUrl, args.inspectionUrl), languageCode } };
    }
    case "google.analytics.accountSummaries.list": {
      keys(args, ["pageSize", "pageToken"]); const url = new URL("https://analyticsadmin.googleapis.com/v1beta/accountSummaries");
      url.searchParams.set("pageSize", String(integer(args.pageSize ?? 50, 1, 200)));
      if (args.pageToken !== undefined) url.searchParams.set("pageToken", text(args.pageToken));
      return { url: url.href };
    }
    case "google.analytics.report.run": {
      keys(args, ["property", "startDate", "endDate", "metrics", "dimensions", "limit", "offset"]);
      const prop = text(args.property, 40); if (!/^properties\/[1-9][0-9]{0,19}$/.test(prop)) throw new IntegrationError("invalid_google_arguments");
      return { url: `https://analyticsdata.googleapis.com/v1beta/${prop}:runReport`, body: { dateRanges: [dates(args.startDate, args.endDate)], metrics: named(args.metrics, 10),
        ...(args.dimensions === undefined ? {} : { dimensions: named(args.dimensions, 9) }), limit: String(integer(args.limit ?? 100, 1, 1000)), offset: String(integer(args.offset ?? 0, 0, 100000)) } };
    }
    default: throw new IntegrationError("google_operation_not_supported");
  }
}
function sanitize(value: unknown, accessToken: string, depth = 0): unknown {
  if (depth > 20) return "[depth limited]";
  if (typeof value === "string") return value.split(accessToken).join("[redacted]");
  if (Array.isArray(value)) return value.map(v => sanitize(v, accessToken, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, /^(?:access_token|refresh_token|id_token|authorization|password|client_secret)$/i.test(k) ? "[redacted]" : sanitize(v, accessToken, depth + 1)]));
  return value;
}
export async function executeGoogleRead(provider: GoogleProvider, accessToken: string, operation: string, args: Record<string, unknown>): Promise<unknown> {
  if (!GOOGLE_READ_OPERATIONS.some(row => row.name === operation && row.provider === provider)) throw new IntegrationError("google_provider_operation_mismatch");
  if (typeof accessToken !== "string" || accessToken.length < 10 || accessToken.length > 16384 || /[\s\x00-\x1f\x7f]/.test(accessToken)) throw new IntegrationError("google_authorization_required", 401);
  const request = target(operation, args);
  try {
    const response = await fetch(request.url, { method: request.body ? "POST" : "GET", headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json", ...(request.body ? { "Content-Type": "application/json" } : {}) },
      ...(request.body ? { body: JSON.stringify(request.body) } : {}), redirect: "error", cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw new IntegrationError(response.status === 401 ? "google_reauthorization_required" : response.status === 403 ? "google_access_denied_or_api_disabled" : response.status === 429 ? "google_rate_limited" : "google_api_request_failed", [401, 403, 429].includes(response.status) ? response.status : 502); }
    if (Number(response.headers.get("content-length")) > MAX_RESPONSE) { await response.body?.cancel().catch(() => undefined); throw new IntegrationError("google_response_limit", 502); }
    const reader = response.body?.getReader(); if (!reader) throw new IntegrationError("google_invalid_response", 502);
    const chunks: Uint8Array[] = []; let bytes = 0;
    try { for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > MAX_RESPONSE) throw new IntegrationError("google_response_limit", 502); chunks.push(part.value); } }
    finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new IntegrationError("google_invalid_response", 502);
    return sanitize(value, accessToken);
  } catch (error) { throw error instanceof IntegrationError ? error : new IntegrationError("google_api_unavailable", 502); }
}
