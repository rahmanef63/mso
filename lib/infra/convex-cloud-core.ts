import { obj, request, TIMEOUT_MS } from "./http";
import { IntegrationError } from "./identity";

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
export type ConvexRequestDestination = "convexCloud" | "convexSite";
export type ConvexCustomDomain = {
  domain: string;
  deploymentName: string;
  requestDestination: ConvexRequestDestination;
  creationTime: number;
  verificationTime: number | null;
};
const DEPLOYMENT_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const HOST_RE =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export function convexDeploymentName(value: unknown): string {
  if (typeof value !== "string")
    throw new IntegrationError("invalid_convex_deployment_name");
  const clean = value.trim().toLowerCase();
  if (!DEPLOYMENT_RE.test(clean))
    throw new IntegrationError("invalid_convex_deployment_name");
  return clean;
}
export function convexDestination(value: unknown): ConvexRequestDestination {
  if (value !== "convexCloud" && value !== "convexSite")
    throw new IntegrationError("invalid_convex_request_destination");
  return value;
}
export function convexDomainName(value: unknown): string {
  if (typeof value !== "string")
    throw new IntegrationError("invalid_convex_custom_domain");
  const clean = value.trim().toLowerCase().replace(/\.$/, "");
  if (!HOST_RE.test(clean))
    throw new IntegrationError("invalid_convex_custom_domain");
  return clean;
}
export function convexCanonicalOrigin(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string")
    throw new IntegrationError("invalid_convex_canonical_url");
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new IntegrationError("invalid_convex_canonical_url");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  )
    throw new IntegrationError("invalid_convex_canonical_url");
  return `https://${convexDomainName(url.hostname)}`;
}
export function convexAuthHeaders(token: string, scheme: "Bearer" | "Convex") {
  return {
    authorization: `${scheme} ${token}`,
    accept: "application/json",
    "content-type": "application/json",
  };
}
export function convexManagementUrl(name: string, suffix: string) {
  return `https://api.convex.dev/v1/deployments/${encodeURIComponent(convexDeploymentName(name))}/${suffix}`;
}
/** A Convex deployment can live outside the US region, and the host then carries it:
 *  `laudable-bat-171.ap-southeast-2.convex.cloud`. Omitting the region answers 404, which is how
 *  this was found — verified live against an ap-southeast-2 prod deployment on 2026-11-02.
 *  `region` is optional so existing US callers are unchanged. */
const REGION_RE = /^[a-z]{2}(?:-[a-z]+)+-\d{1,2}$/;
export function convexDeploymentUrl(name: string, suffix: string, region?: string) {
  const host = region ? `${convexDeploymentName(name)}.${convexRegion(region)}` : convexDeploymentName(name);
  return `https://${host}.convex.cloud/api/v1/${suffix}`;
}
export function convexRegion(value: unknown): string {
  if (typeof value !== "string") throw new IntegrationError("invalid_convex_region");
  const clean = value.trim().toLowerCase();
  if (!REGION_RE.test(clean)) throw new IntegrationError("invalid_convex_region");
  return clean;
}
export async function convexCheckedJson(
  provider: string,
  url: string,
  init: RequestInit,
  fetchImpl: FetchLike,
): Promise<unknown> {
  let response;
  try {
    response = await request(url, init, TIMEOUT_MS, fetchImpl);
  } catch (cause) {
    // Keep the cause as redactable detail: dropping it made a live env-write failure
    // indistinguishable from a network error, and hid the value-redaction test's subject.
    const error = new IntegrationError(`${provider}_request_failed`, 502);
    const detail = cause instanceof Error ? cause.message : String(cause);
    if (detail) Object.assign(error, { detail });
    throw error;
  }
  if (!response.ok) {
    const error = new IntegrationError(
      `${provider}_http_${response.status}`,
      response.status >= 500 ? 502 : 409,
    );
    // Bodies carry the server's reason, which is what a caller needs; the transport used to drop it.
    const detail = typeof response.body === "string" ? response.body : JSON.stringify(response.body ?? "");
    if (detail && detail !== "{}") Object.assign(error, { detail: detail.slice(0, 500) });
    throw error;
  }
  return response.body;
}
export function parseConvexDomains(value: unknown): ConvexCustomDomain[] {
  const rows = obj(value).domains;
  if (!Array.isArray(rows))
    throw new IntegrationError("invalid_convex_custom_domains_response", 502);
  return rows.map((raw) => {
    const row = obj(raw),
      requestDestination = convexDestination(row.requestDestination),
      domain = convexDomainName(row.domain),
      deploymentName = convexDeploymentName(row.deploymentName);
    const creationTime = Number(row.creationTime),
      verificationTime =
        row.verificationTime == null ? null : Number(row.verificationTime);
    if (
      !Number.isFinite(creationTime) ||
      (verificationTime !== null && !Number.isFinite(verificationTime))
    )
      throw new IntegrationError("invalid_convex_custom_domains_response", 502);
    return {
      domain,
      deploymentName,
      requestDestination,
      creationTime,
      verificationTime,
    };
  });
}
export function parseConvexCanonical(value: unknown) {
  const row = obj(value),
    convexCloudUrl = convexCanonicalOrigin(row.convexCloudUrl),
    convexSiteUrl = convexCanonicalOrigin(row.convexSiteUrl);
  if (!convexCloudUrl || !convexSiteUrl)
    throw new IntegrationError("invalid_convex_canonical_response", 502);
  return { convexCloudUrl, convexSiteUrl };
}
