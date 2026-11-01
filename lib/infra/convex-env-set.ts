import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { obj } from "./http";
import { IntegrationError } from "./identity";
import { readInfraProvider } from "./store";
import { currentIntegrationSelection } from "./connection-service";
import {
  convexAuthHeaders,
  convexCheckedJson,
  convexDeploymentName,
  convexManagementUrl,
  type FetchLike,
} from "./convex-cloud-core";
import {
  convexCliEnv,
  convexProjectContext,
  redactConvexCliText,
  runConvexCli,
  type RunConvexCli,
} from "./convex-cloud-cli-runner";

export type ConvexEnvSetDeps = {
  fetchImpl?: FetchLike;
  runCli?: RunConvexCli;
};

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const MAX_ENV_VALUE_BYTES = 8 * 1024;
const ENV_SET_TIMEOUT_MS = 60_000;

function validateEnvName(value: unknown): string {
  if (typeof value !== "string" || !ENV_NAME.test(value.trim()))
    throw new IntegrationError("invalid_convex_env_name");
  return value.trim();
}

function validateEnvValue(value: unknown): string {
  if (typeof value !== "string")
    throw new IntegrationError("invalid_convex_env_value");
  if (Buffer.byteLength(value, "utf8") > MAX_ENV_VALUE_BYTES)
    throw new IntegrationError("convex_env_value_too_large");
  return value;
}

function redactValueFromError(error: unknown, value: string): void {
  if (!error || !value || typeof error !== "object") return;
  const anyErr = error as Record<string, unknown>;
  if (typeof anyErr.message === "string" && anyErr.message.includes(value)) {
    anyErr.message = anyErr.message.split(value).join("[REDACTED_VALUE]");
  }
  if (typeof anyErr.detail === "string" && anyErr.detail.includes(value)) {
    anyErr.detail = anyErr.detail.split(value).join("[REDACTED_VALUE]");
  }
}

export async function setConvexEnv(
  input: {
    deploymentName?: string;
    name: string;
    value: string;
    projectPath?: string;
  },
  deps: ConvexEnvSetDeps = {},
) {
  const name = validateEnvName(input.name);
  const value = validateEnvValue(input.value);

  const providerValues = await readInfraProvider("convex-cloud");
  const token = providerValues.personalToken;
  if (!token) throw new IntegrationError("convex_personal_token_required", 409);

  const candidateDeployment =
    typeof input.deploymentName === "string" && input.deploymentName.trim().length > 0
      ? input.deploymentName.trim()
      : typeof providerValues.deploymentName === "string" && providerValues.deploymentName.trim().length > 0
        ? providerValues.deploymentName.trim()
        : "";

  if (!candidateDeployment)
    throw new IntegrationError("convex_deployment_name_required", 409);

  const deployment = convexDeploymentName(candidateDeployment);
  const keyName = `mso-env-set-${randomUUID()}`;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const execute = deps.runCli ?? runConvexCli;

  const created = obj(
    await convexCheckedJson(
      "convex_cloud",
      convexManagementUrl(deployment, "create_deploy_key"),
      {
        method: "POST",
        headers: convexAuthHeaders(token, "Bearer"),
        body: JSON.stringify({
          name: keyName,
          allowedActions: ["deployment:env:view", "deployment:env:write"],
        }),
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

  let primary: unknown;
  let secretFile: string | undefined;
  try {
    const projectPath = input.projectPath ?? currentIntegrationSelection().cwd;
    const { project, executable } = await convexProjectContext(projectPath);
    // The value must NOT travel as an argv element: any process on the host can read
    // /proc/<pid>/cmdline while the CLI runs, and `env set NAME <value>` puts the secret there.
    // `--from-file` keeps it in a 0600 file that is removed in the finally below.
    secretFile = path.join(os.tmpdir(), `mso-convex-env-${randomUUID()}`);
    await fs.writeFile(secretFile, `${name}=${value}\n`, { mode: 0o600, flag: "wx" });
    const result = await execute(executable, ["env", "set", "--from-file", secretFile], {
      cwd: project,
      env: convexCliEnv(deployKey),
      timeoutMs: ENV_SET_TIMEOUT_MS,
    });
    if (result.code !== 0) {
      const redacted = redactConvexCliText(
        [result.stderr, result.stdout].filter(Boolean).join("\n"),
        deployKey,
      )
        .split(value)
        .join("[REDACTED_VALUE]");
      const error = new IntegrationError("convex_cloud_env_set_failed", 502);
      Object.assign(error, {
        detail: redacted || `convex env set exited ${result.code}`,
      });
      throw error;
    }
  } catch (error) {
    primary = error;
  } finally {
    if (secretFile) await fs.rm(secretFile, { force: true }).catch(() => undefined);
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
      primary
        ? "convex_operation_and_ephemeral_cleanup_failed"
        : "convex_ephemeral_cleanup_failed",
      502,
    );
  }

  if (primary) {
    redactValueFromError(primary, value);
    throw primary;
  }

  return {
    deploymentName: deployment,
    name,
    set: true,
  };
}
