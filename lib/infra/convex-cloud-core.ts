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
export function convexDeploymentUrl(name: string, suffix: string) {
  return `https://${convexDeploymentName(name)}.convex.cloud/api/v1/${suffix}`;
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
  } catch {
    throw new IntegrationError(`${provider}_request_failed`, 502);
  }
  if (!response.ok)
    throw new IntegrationError(
      `${provider}_http_${response.status}`,
      response.status >= 500 ? 502 : 409,
    );
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
