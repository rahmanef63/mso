import { randomUUID } from "node:crypto";
import { obj } from "./http";
import { IntegrationError } from "./identity";
import { readInfraProvider } from "./store";
import {
  convexAuthHeaders,
  convexCanonicalOrigin,
  convexCheckedJson,
  convexDeploymentName,
  convexDeploymentUrl,
  convexDestination,
  convexManagementUrl,
  parseConvexCanonical,
  parseConvexDomains,
  type ConvexRequestDestination,
  type FetchLike,
} from "./convex-cloud-core";

const EPHEMERAL_ACTIONS = [
  "deployment:env:view",
  "deployment:env:write",
] as const;
async function personalToken(): Promise<string> {
  const values = await readInfraProvider("convex-cloud"),
    token = values.personalToken;
  if (!token) throw new IntegrationError("convex_personal_token_required", 409);
  return token;
}
async function withEphemeralDeployKey<T>(
  deployment: string,
  token: string,
  fn: (deployKey: string) => Promise<T>,
  fetchImpl: FetchLike,
): Promise<T> {
  const name = `mso-canonical-${randomUUID()}`;
  const created = obj(
    await convexCheckedJson(
      "convex_cloud",
      convexManagementUrl(deployment, "create_deploy_key"),
      {
        method: "POST",
        headers: convexAuthHeaders(token, "Bearer"),
        body: JSON.stringify({ name, allowedActions: [...EPHEMERAL_ACTIONS] }),
      },
      fetchImpl,
    ),
  );
  const deployKey = created.deployKey;
  if (
    typeof deployKey !== "string" ||
    deployKey.length < 20 ||
    /[\x00-\x20\x7f]/.test(deployKey)
  )
    throw new IntegrationError("invalid_convex_deploy_key_response", 502);
  let result: T | undefined, primary: unknown;
  try {
    result = await fn(deployKey);
  } catch (error) {
    primary = error;
  }
  try {
    await convexCheckedJson(
      "convex_cloud",
      convexManagementUrl(deployment, "delete_deploy_key"),
      {
        method: "POST",
        headers: convexAuthHeaders(token, "Bearer"),
        body: JSON.stringify({ id: name }),
      },
      fetchImpl,
    );
  } catch {
    throw new IntegrationError(
      primary
        ? "convex_operation_and_ephemeral_cleanup_failed"
        : "convex_ephemeral_cleanup_failed",
      502,
    );
  }
  if (primary) throw primary;
  return result as T;
}
export async function getConvexCanonicalUrls(
  name: string,
  fetchImpl: FetchLike = fetch,
) {
  const deployment = convexDeploymentName(name),
    token = await personalToken();
  const canonical = await withEphemeralDeployKey(
    deployment,
    token,
    async (deployKey) => {
      const body = await convexCheckedJson(
        "convex_deployment",
        convexDeploymentUrl(deployment, "get_canonical_urls"),
        { method: "GET", headers: convexAuthHeaders(deployKey, "Convex") },
        fetchImpl,
      );
      return parseConvexCanonical(body);
    },
    fetchImpl,
  );
  return { deploymentName: deployment, ...canonical };
}
export async function setConvexCanonicalUrl(
  input: {
    deploymentName: string;
    requestDestination: ConvexRequestDestination;
    url?: string | null;
  },
  fetchImpl: FetchLike = fetch,
) {
  const deployment = convexDeploymentName(input.deploymentName),
    requestDestination = convexDestination(input.requestDestination),
    url = convexCanonicalOrigin(input.url),
    token = await personalToken();
  if (url) {
    const body = await convexCheckedJson(
      "convex_cloud",
      convexManagementUrl(deployment, "custom_domains"),
      { method: "GET", headers: convexAuthHeaders(token, "Bearer") },
      fetchImpl,
    );
    const host = new URL(url).hostname,
      custom = parseConvexDomains(body).find(
        (row) =>
          row.domain === host && row.requestDestination === requestDestination,
      );
    if (!custom)
      throw new IntegrationError("convex_canonical_domain_not_registered", 409);
    if (custom.verificationTime === null)
      throw new IntegrationError("convex_canonical_domain_not_verified", 409);
  }
  const canonical = await withEphemeralDeployKey(
    deployment,
    token,
    async (deployKey) => {
      await convexCheckedJson(
        "convex_deployment",
        convexDeploymentUrl(deployment, "update_canonical_url"),
        {
          method: "POST",
          headers: convexAuthHeaders(deployKey, "Convex"),
          body: JSON.stringify({ requestDestination, ...(url ? { url } : {}) }),
        },
        fetchImpl,
      );
      const body = await convexCheckedJson(
        "convex_deployment",
        convexDeploymentUrl(deployment, "get_canonical_urls"),
        { method: "GET", headers: convexAuthHeaders(deployKey, "Convex") },
        fetchImpl,
      );
      return parseConvexCanonical(body);
    },
    fetchImpl,
  );
  const selected =
    requestDestination === "convexCloud"
      ? canonical.convexCloudUrl
      : canonical.convexSiteUrl;
  if (url && selected !== url)
    throw new IntegrationError("convex_canonical_verification_failed", 502);
  if (!url) {
    const suffix =
      requestDestination === "convexCloud" ? ".convex.cloud" : ".convex.site";
    if (!new URL(selected).hostname.endsWith(suffix))
      throw new IntegrationError("convex_canonical_verification_failed", 502);
  }
  return {
    changed: true,
    deploymentName: deployment,
    requestDestination,
    canonical,
  };
}
