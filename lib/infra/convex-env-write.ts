// Write, update and delete Convex deployment environment variables.
//
// DESIGN CORRECTION, from a live deployment (`laudable-bat-171`, 2026-11-02). An earlier version of
// this file minted an ephemeral deploy key from the personal token and shelled out to
// `convex env set --from-file`. Both halves were unnecessary:
//
//   POST https://<deployment>.convex.cloud/api/v1/update_environment_variables
//   authorization: Convex <deploy key>            <- the key itself, no minting needed
//   { "changes": [ { "name": "K", "value": "V" } ] }
//
// Verified against the live deployment: create 200, update 200, delete 200, list reflects each
// change. A deployment deploy key (`prod:<name>|…`) carries `deployment:env:write` for its own
// deployment, so no personal token, no ephemeral key, and no CLI project checkout are required.
//
// That matters beyond convenience: the CLI path required a project directory with
// `node_modules/.bin/convex`, which a credential connection does not have. The HTTP path works for
// the thing the connection actually is.
//
// Value redaction stays: callers must never see the value back, in output or in an error.
import { IntegrationError } from "./identity";
import { readInfraProvider } from "./store";
import {
  convexAuthHeaders,
  convexCheckedJson,
  convexDeploymentName,
  convexDeploymentUrl,
  type FetchLike,
} from "./convex-cloud-core";

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
/** Convex caps a single value at 8 KiB. */
const MAX_ENV_VALUE_BYTES = 8 * 1024;

function envName(value: unknown): string {
  if (typeof value !== "string" || !ENV_NAME.test(value.trim()))
    throw new IntegrationError("invalid_convex_env_name");
  return value.trim();
}

function envValue(value: unknown): string {
  if (typeof value !== "string") throw new IntegrationError("invalid_convex_env_value");
  if (Buffer.byteLength(value, "utf8") > MAX_ENV_VALUE_BYTES)
    throw new IntegrationError("convex_env_value_too_large");
  return value;
}

/** Keep a caller-supplied secret out of anything that can be surfaced. */
function redact(error: unknown, value: string): void {
  if (!error || !value || typeof error !== "object") return;
  const target = error as Record<string, unknown>;
  for (const key of ["message", "detail"] as const) {
    if (typeof target[key] === "string" && (target[key] as string).includes(value))
      target[key] = (target[key] as string).split(value).join("[REDACTED_VALUE]");
  }
}

/** Run a request and scrub every given secret out of whatever it throws.
 *  Wrapping here rather than around each call site keeps the guarantee in one place: the transport
 *  rethrows a normalised error, so a call-site-local catch would otherwise miss the value. */
async function withRedaction(secrets: string[], run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    for (const secret of secrets) redact(error, secret);
    throw error;
  }
}

async function deploymentFor(input: { deploymentName?: string }): Promise<{ name: string; key: string; region?: string }> {
  const values = await readInfraProvider("convex-cloud");
  const key = values.deployKey;
  if (!key) throw new IntegrationError("convex_deploy_key_required", 409);
  const chosen =
    (typeof input.deploymentName === "string" && input.deploymentName.trim()) ||
    (typeof values.deploymentName === "string" && values.deploymentName.trim()) ||
    "";
  if (!chosen) throw new IntegrationError("convex_deployment_name_required", 409);
  // A non-US deployment needs its region in the host; without it every call answers 404.
  const region = typeof values.deploymentRegion === "string" && values.deploymentRegion.trim()
    ? values.deploymentRegion.trim()
    : undefined;
  return { name: convexDeploymentName(chosen), key, region };
}

/** One POST carrying every change. `delete` removes a name; `value` sets it. */
async function postChanges(
  deployment: string,
  key: string,
  changes: Array<{ name: string; value?: string; delete?: true }>,
  fetchImpl: FetchLike,
  region?: string,
): Promise<void> {
  await convexCheckedJson(
    "convex_deployment",
    convexDeploymentUrl(deployment, "update_environment_variables", region),
    {
      method: "POST",
      headers: convexAuthHeaders(key, "Convex"),
      body: JSON.stringify({ changes }),
    },
    fetchImpl,
  );
}

export type ConvexEnvChange = { name: string; value: string };

/** Set one value. Never returns it. */
export async function setConvexEnv(
  input: { deploymentName?: string; name: string; value: string },
  fetchImpl: FetchLike = fetch,
) {
  const name = envName(input.name);
  const value = envValue(input.value);
  const { name: deployment, key, region } = await deploymentFor(input);
  await withRedaction([value], () => postChanges(deployment, key, [{ name, value }], fetchImpl, region));
  return { deploymentName: deployment, name, set: true as const };
}

/** Set several at once — one request, which is what Convex's API is shaped for. */
export async function setConvexEnvs(
  input: { deploymentName?: string; changes: ConvexEnvChange[] },
  fetchImpl: FetchLike = fetch,
) {
  if (!Array.isArray(input.changes) || input.changes.length < 1 || input.changes.length > 32)
    throw new IntegrationError("invalid_convex_env_changes");
  const changes = input.changes.map((row) => ({ name: envName(row.name), value: envValue(row.value) }));
  const { name: deployment, key, region } = await deploymentFor(input);
  await withRedaction(changes.map((row) => row.value), () => postChanges(deployment, key, changes, fetchImpl, region));
  return { deploymentName: deployment, names: changes.map((row) => row.name), set: true as const };
}

/** Remove names. Convex deletes on `delete: true` with no value. */
export async function removeConvexEnvs(
  input: { deploymentName?: string; names: string[] },
  fetchImpl: FetchLike = fetch,
) {
  if (!Array.isArray(input.names) || input.names.length < 1 || input.names.length > 32)
    throw new IntegrationError("invalid_convex_env_names");
  const names = [...new Set(input.names.map(envName))];
  const { name: deployment, key, region } = await deploymentFor(input);
  await postChanges(deployment, key, names.map((name) => ({ name, delete: true as const })), fetchImpl, region);
  return { deploymentName: deployment, names, removed: true as const };
}
