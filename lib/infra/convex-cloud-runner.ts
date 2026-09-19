import { convexDeploymentName, type FetchLike } from "./convex-cloud-core";
import {
  convexCliEnv,
  convexProjectContext,
  convexSnapshotContext,
  runConvexCli,
  throwConvexCliFailure,
  type RunConvexCli,
} from "./convex-cloud-cli-runner";
import {
  convexCloudPersonalToken,
  withConvexEphemeralDeployKey,
} from "./convex-cloud-key";
import { IntegrationError } from "./identity";

type RunnerDeps = {
  fetchImpl?: FetchLike;
  runCli?: RunConvexCli;
};

const DEPLOY_TIMEOUT_MS = 4 * 60_000;
const IMPORT_TIMEOUT_MS = 8 * 60_000;

export async function deployConvexCloudProject(
  input: { deploymentName: string; projectPath: string },
  deps: RunnerDeps = {},
) {
  const deployment = convexDeploymentName(input.deploymentName);
  const token = await convexCloudPersonalToken();
  const { project, executable } = await convexProjectContext(input.projectPath);
  const fetchImpl = deps.fetchImpl ?? fetch;
  const execute = deps.runCli ?? runConvexCli;

  return withConvexEphemeralDeployKey(
    deployment,
    token,
    ["deployment:deploy"],
    async (deployKey) => {
      const result = await execute(executable, ["deploy", "--yes"], {
        cwd: project,
        env: convexCliEnv(deployKey),
        timeoutMs: DEPLOY_TIMEOUT_MS,
      });
      if (result.code !== 0) throwConvexCliFailure("deploy", result, deployKey);
      return {
        deploymentName: deployment,
        projectPath: project,
        deployed: true,
        durationMs: result.durationMs,
      };
    },
    fetchImpl,
  );
}

export async function importConvexCloudSnapshot(
  input: {
    deploymentName: string;
    projectPath: string;
    snapshotPath: string;
    mode: "replace-all" | "append";
  },
  deps: RunnerDeps = {},
) {
  const deployment = convexDeploymentName(input.deploymentName);
  if (input.mode !== "replace-all" && input.mode !== "append")
    throw new IntegrationError("invalid_convex_import_mode");
  const token = await convexCloudPersonalToken();
  const { project, executable } = await convexProjectContext(input.projectPath);
  const snap = await convexSnapshotContext(input.snapshotPath);
  const fetchImpl = deps.fetchImpl ?? fetch;
  const execute = deps.runCli ?? runConvexCli;

  return withConvexEphemeralDeployKey(
    deployment,
    token,
    ["deployment:data:view", "deployment:data:write", "deployment:backups:view", "deployment:backups:import"],
    async (deployKey) => {
      const modeFlag = input.mode === "replace-all" ? "--replace-all" : "--append";
      const result = await execute(
        executable,
        ["import", snap.snapshot, modeFlag, "--yes"],
        {
          cwd: project,
          env: convexCliEnv(deployKey),
          timeoutMs: IMPORT_TIMEOUT_MS,
        },
      );
      if (result.code !== 0) throwConvexCliFailure("import", result, deployKey);
      return {
        deploymentName: deployment,
        projectPath: project,
        imported: true,
        mode: input.mode,
        snapshot: {
          path: snap.snapshot,
          bytes: snap.size,
          sha256: snap.sha256,
        },
        durationMs: result.durationMs,
      };
    },
    fetchImpl,
  );
}
