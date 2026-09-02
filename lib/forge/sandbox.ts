import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { ForgeFixture, ForgeFunctionSpec } from "./types";

const SECRETISH = /(password|passwd|secret|token|authorization|bearer|api[_-]?key)/i;
const MAX_CAPTURE = 64 * 1024;
const DEFAULT_NODE_IMAGE = "mso-forge-sandbox:node22-v1";

function inside(root: string, child: string): boolean {
  const rel = path.relative(root, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

async function regularProjectFile(projectReal: string, value: string): Promise<string | null> {
  const candidate = path.resolve(projectReal, value);
  const real = await fs.realpath(candidate).catch(() => null);
  if (!real || !inside(projectReal, real)) return null;
  const stat = await fs.lstat(candidate).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink()) return null;
  return real;
}

export type ForgeCommandResolution = {
  interpreter: "node";
  script: string;
  fixedArgs: string[];
};

export async function validateForgeCommand(projectPath: string, spec: ForgeFunctionSpec): Promise<ForgeCommandResolution> {
  const projectReal = await fs.realpath(projectPath).catch(() => null);
  if (!projectReal) throw new Error("forge project no longer exists");
  if (!spec.command.length || spec.command.length > 16 || spec.command.some((arg) => arg.length > 512 || arg.includes("\0"))) {
    throw new Error("forge command must contain 1-16 bounded fixed argv strings");
  }
  if (spec.command.some((arg) => SECRETISH.test(arg))) throw new Error("forge command contains secret-like fixed argv; use project-owned runtime configuration instead");

  const head = path.basename(spec.command[0]!);
  if (head !== "node") throw new Error("P2 forged project functions support only Node scripts; arbitrary executables and shell interpreters are not accepted");
  if (spec.command.length < 2 || spec.command[1]!.startsWith("-")) throw new Error("node forge functions must name a project-owned script as argv[1]");
  const script = await regularProjectFile(projectReal, spec.command[1]!);
  if (!script) throw new Error("forge Node target must be a regular non-symlink file inside the project");
  return { interpreter: "node", script, fixedArgs: spec.command.slice(2) };
}

function sandboxImage(): string {
  return process.env.OS_TOOL_FORGE_NODE_IMAGE?.trim() || DEFAULT_NODE_IMAGE;
}

export function forgeSandboxImageEvidence(): { image: string; imageId: string } {
  const image = sandboxImage();
  // `docker image inspect` is intentionally local-only. Evaluation never pulls an image or hits a registry.
  const format = '{{.Id}}|{{ index .Config.Labels "org.mso.tool-forge.version" }}|{{ index .Config.Labels "org.mso.tool-forge.runtime" }}';
  const found = spawnSync("/usr/bin/docker", ["image", "inspect", "--format", format, image], {
    encoding: "utf8", timeout: 5_000, env: { PATH: "/usr/bin:/bin" } as unknown as NodeJS.ProcessEnv,
  });
  const [imageId, version, runtime] = String(found.stdout).trim().split("|");
  if (found.status !== 0 || !imageId) {
    throw new Error(`Tool Forge sandbox image is not cached locally: ${image}; run scripts/provision-forge-sandbox.sh explicitly`);
  }
  if (version !== "1" || runtime !== "node") {
    throw new Error(`Tool Forge sandbox image ${image} lacks the required MSO Forge v1/node provenance labels; reprovision it before evaluation`);
  }
  return { image, imageId };
}

export async function runForgeFixture(projectPath: string, spec: ForgeFunctionSpec, fixture: ForgeFixture): Promise<{ code: number; stdout: string; stderr: string; sandboxImageId: string }> {
  const resolved = await validateForgeCommand(projectPath, spec);
  const projectReal = await fs.realpath(projectPath);
  const { image, imageId } = forgeSandboxImageEvidence();
  const relScript = path.relative(projectReal, resolved.script);
  if (!relScript || relScript.startsWith("..") || path.isAbsolute(relScript)) throw new Error("forge script escaped project snapshot");
  const sandboxScript = `/workspace/${relScript.split(path.sep).join("/")}`;
  const uid = typeof process.getuid === "function" ? process.getuid() : 65534;
  const gid = typeof process.getgid === "function" ? process.getgid() : 65534;
  const runtimeSec = Math.max(1, Math.ceil(Math.min(spec.timeoutMs, 5_000) / 1000));
  const args = [
    "run", "--rm", "-i", "--network", "none", "--read-only", "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges", "--pids-limit", "64", "--memory", "256m", "--cpus", "1",
    "--user", `${uid}:${gid}`, "--workdir", "/workspace", "--env", "HOME=/tmp", "--env", "TMPDIR=/tmp",
    "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=32m",
    "--mount", `type=bind,src=${projectReal},dst=/workspace,readonly`,
    "--entrypoint", "/usr/bin/node", imageId, sandboxScript, ...resolved.fixedArgs,
  ];
  const payload = JSON.stringify(fixture.input);
  return new Promise((resolve) => {
    const child = spawn("/usr/bin/docker", args, {
      stdio: ["pipe", "pipe", "pipe"], env: { PATH: "/usr/bin:/bin" } as unknown as NodeJS.ProcessEnv,
    }) as ChildProcessWithoutNullStreams;
    let stdout = "", stderr = "", finished = false;
    const append = (current: string, chunk: Buffer) => (current + chunk.toString("utf8")).slice(0, MAX_CAPTURE);
    child.stdout.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
    const timer = setTimeout(() => { if (!finished) child.kill("SIGKILL"); }, (runtimeSec + 2) * 1000);
    child.on("error", (error: Error) => {
      if (!finished) { finished = true; clearTimeout(timer); resolve({ code: 1, stdout, stderr: `${stderr}${error.message}`, sandboxImageId: imageId }); }
    });
    child.on("close", (code: number | null) => {
      if (!finished) { finished = true; clearTimeout(timer); resolve({ code: code ?? 1, stdout, stderr, sandboxImageId: imageId }); }
    });
    child.stdin.end(payload);
  });
}
