import { randomUUID } from "node:crypto";
import { obj } from "./http";
import { IntegrationError } from "./identity";
import { readInfraProvider } from "./store";
import {
  convexAuthHeaders,
  convexCheckedJson,
  convexDeploymentName,
  convexDeploymentUrl,
  convexManagementUrl,
  type FetchLike,
} from "./convex-cloud-core";

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
function requestedNames(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32)
    throw new IntegrationError("invalid_convex_env_names");
  const names = [...new Set(value.map((item) => (typeof item === "string" ? item.trim() : "")))];
  if (names.some((name) => !ENV_NAME.test(name)))
    throw new IntegrationError("invalid_convex_env_names");
  return names;
}
async function personalToken(): Promise<string> {
  const token = (await readInfraProvider("convex-cloud")).personalToken;
  if (!token) throw new IntegrationError("convex_personal_token_required", 409);
  return token;
}
export async function getConvexEnvPresence(
  input: { deploymentName: string; names: string[] },
  fetchImpl: FetchLike = fetch,
) {
  const deployment = convexDeploymentName(input.deploymentName),
    names = requestedNames(input.names),
    token = await personalToken(),
    keyName = `mso-env-presence-${randomUUID()}`;
  const created = obj(
    await convexCheckedJson(
      "convex_cloud",
      convexManagementUrl(deployment, "create_deploy_key"),
      {
        method: "POST",
        headers: convexAuthHeaders(token, "Bearer"),
        body: JSON.stringify({ name: keyName, allowedActions: ["deployment:env:view"] }),
      },
      fetchImpl,
    ),
  );
  const deployKey = created.deployKey;
  if (typeof deployKey !== "string" || deployKey.length < 20 || /[\x00-\x20\x7f]/.test(deployKey))
    throw new IntegrationError("invalid_convex_deploy_key_response", 502);
  let body: unknown, primary: unknown;
  try {
    body = await convexCheckedJson(
      "convex_deployment",
      convexDeploymentUrl(deployment, "list_environment_variables"),
      { method: "GET", headers: convexAuthHeaders(deployKey, "Convex") },
      fetchImpl,
    );
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
        body: JSON.stringify({ id: keyName }),
      },
      fetchImpl,
    );
  } catch {
    throw new IntegrationError(
      primary ? "convex_operation_and_ephemeral_cleanup_failed" : "convex_ephemeral_cleanup_failed",
      502,
    );
  }
  if (primary) throw primary;
  const vars = obj(body).environmentVariables;
  if (!vars || typeof vars !== "object" || Array.isArray(vars))
    throw new IntegrationError("invalid_convex_environment_response", 502);
  const keys = new Set(Object.keys(vars));
  return {
    deploymentName: deployment,
    presence: Object.fromEntries(names.map((name) => [name, keys.has(name)])),
  };
}
