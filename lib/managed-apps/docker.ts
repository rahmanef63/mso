import "server-only";
import { commandExists, runProgram, type ProgramResult } from "./runner";

type DockerRunner = { command: string; prefix: readonly string[] };

/** Resolve a Docker client that can actually reach the daemon. */
async function resolveDockerRunner(): Promise<DockerRunner | null> {
  if (!(await commandExists("docker"))) return null;
  const probe = ["version", "--format", "{{.Server.Version}}"] as const;
  const direct = await runProgram("docker", probe, 5_000);
  if (direct.code === 0) return { command: "docker", prefix: [] };
  const sudo = await runProgram("sudo", ["-n", "docker", ...probe], 5_000);
  if (sudo.code === 0) return { command: "sudo", prefix: ["-n", "docker"] };
  return null;
}

export async function dockerUsable(): Promise<boolean> {
  return (await resolveDockerRunner()) !== null;
}

export async function runDocker(args: readonly string[], timeout = 30_000): Promise<ProgramResult> {
  const runner = await resolveDockerRunner();
  if (!runner) return { code: 127, stdout: "", stderr: "docker daemon unavailable to the MSO service user" };
  return runProgram(runner.command, [...runner.prefix, ...args], timeout);
}

export async function requireDocker(args: readonly string[], timeout = 30_000): Promise<void> {
  const result = await runDocker(args, timeout);
  if (result.code !== 0) throw new Error("managed application Docker operation failed");
}
