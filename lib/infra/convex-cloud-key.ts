import { randomUUID } from "node:crypto";
import { obj } from "./http";
import { IntegrationError } from "./identity";
import { readInfraProvider } from "./store";
import {
  convexAuthHeaders,
  convexCheckedJson,
  convexManagementUrl,
  type FetchLike,
} from "./convex-cloud-core";

export async function convexCloudPersonalToken(): Promise<string> {
  const token = (await readInfraProvider("convex-cloud")).personalToken;
  if (!token) throw new IntegrationError("convex_personal_token_required", 409);
  return token;
}

function validDeployKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 20 &&
    !/[\x00-\x20\x7f]/.test(value)
  );
}

export async function withConvexEphemeralDeployKey<T>(
  deployment: string,
  token: string,
  allowedActions: string[],
  fn: (deployKey: string) => Promise<T>,
  fetchImpl: FetchLike,
): Promise<T> {
  const name = `mso-runner-${randomUUID()}`;
  const created = obj(
    await convexCheckedJson(
      "convex_cloud",
      convexManagementUrl(deployment, "create_deploy_key"),
      {
        method: "POST",
        headers: convexAuthHeaders(token, "Bearer"),
        body: JSON.stringify({ name, allowedActions }),
      },
      fetchImpl,
    ),
  );
  const deployKey = created.deployKey;
  if (!validDeployKey(deployKey))
    throw new IntegrationError("invalid_convex_deploy_key_response", 502);

  let result: T | undefined;
  let primary: unknown;
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
