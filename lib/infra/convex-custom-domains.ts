import { IntegrationError } from "./identity";
import { readInfraProvider } from "./store";
import {
  convexAuthHeaders,
  convexCheckedJson,
  convexDeploymentName,
  convexDestination,
  convexDomainName,
  convexManagementUrl,
  parseConvexDomains,
  type ConvexRequestDestination,
  type FetchLike,
} from "./convex-cloud-core";

async function personalToken(): Promise<string> {
  const values = await readInfraProvider("convex-cloud"),
    token = values.personalToken;
  if (!token) throw new IntegrationError("convex_personal_token_required", 409);
  return token;
}
export async function listConvexCustomDomains(
  name: string,
  fetchImpl: FetchLike = fetch,
) {
  const deployment = convexDeploymentName(name),
    token = await personalToken();
  const body = await convexCheckedJson(
    "convex_cloud",
    convexManagementUrl(deployment, "custom_domains"),
    { method: "GET", headers: convexAuthHeaders(token, "Bearer") },
    fetchImpl,
  );
  return { deploymentName: deployment, domains: parseConvexDomains(body) };
}
export async function ensureConvexCustomDomain(
  input: {
    deploymentName: string;
    domain: string;
    requestDestination: ConvexRequestDestination;
  },
  fetchImpl: FetchLike = fetch,
) {
  const deployment = convexDeploymentName(input.deploymentName),
    host = convexDomainName(input.domain),
    requestDestination = convexDestination(input.requestDestination),
    token = await personalToken();
  const beforeBody = await convexCheckedJson(
    "convex_cloud",
    convexManagementUrl(deployment, "custom_domains"),
    { method: "GET", headers: convexAuthHeaders(token, "Bearer") },
    fetchImpl,
  );
  const before = parseConvexDomains(beforeBody),
    exact = before.find(
      (row) =>
        row.domain === host && row.requestDestination === requestDestination,
    );
  if (exact)
    return { changed: false, deploymentName: deployment, domain: exact };
  if (before.some((row) => row.domain === host))
    throw new IntegrationError(
      "convex_custom_domain_destination_conflict",
      409,
    );
  await convexCheckedJson(
    "convex_cloud",
    convexManagementUrl(deployment, "create_custom_domain"),
    {
      method: "POST",
      headers: convexAuthHeaders(token, "Bearer"),
      body: JSON.stringify({ domain: host, requestDestination }),
    },
    fetchImpl,
  );
  const afterBody = await convexCheckedJson(
    "convex_cloud",
    convexManagementUrl(deployment, "custom_domains"),
    { method: "GET", headers: convexAuthHeaders(token, "Bearer") },
    fetchImpl,
  );
  const created = parseConvexDomains(afterBody).find(
    (row) =>
      row.domain === host && row.requestDestination === requestDestination,
  );
  if (!created)
    throw new IntegrationError("convex_custom_domain_not_persisted", 502);
  return {
    changed: true,
    deploymentName: deployment,
    domain: created,
    dns: { type: "CNAME" as const, name: host, content: "convex.domains" },
  };
}
