// SERVER-ONLY. Exec-scope runner for ONE function from a project's opt-in
// .mso/functions.json. Manifest argv is fixed project data; caller JSON travels
// only on stdin. No shell, no interpolation, credential-scrubbed environment.
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { childEnv } from "./child-env";
import { PROJECT_FUNCTIONS_REL, readProjectFunctionsManifest, type ProjectFunction } from "./project-function-manifest";

const MAX_INPUT_BYTES = 128 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const plainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

function typeMatches(type: unknown, value: unknown): boolean {
  if (type === "string") return typeof value === "string";
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  if (type === "boolean") return typeof value === "boolean";
  if (type === "object") return plainObject(value);
  if (type === "array") return Array.isArray(value);
  if (type === "null") return value === null;
  return true;
}

function validateInput(definition: ProjectFunction, input: Record<string, unknown>): void {
  for (const required of definition.inputSchema.required ?? []) {
    if (!Object.prototype.hasOwnProperty.call(input, required)) throw new Error(`${definition.name}: missing required input.${required}`);
  }
  if (definition.inputSchema.additionalProperties === false) {
    const unknown = Object.keys(input).find((key) => !Object.prototype.hasOwnProperty.call(definition.inputSchema.properties, key));
    if (unknown) throw new Error(`${definition.name}: unknown input.${unknown}`);
  }
  for (const [key, value] of Object.entries(input)) {
    const property = definition.inputSchema.properties[key];
    if (!plainObject(property)) continue;
    if (!typeMatches(property.type, value)) throw new Error(`${definition.name}: input.${key} has wrong type`);
    if (Array.isArray(property.enum) && !property.enum.some((candidate) => JSON.stringify(candidate) === JSON.stringify(value))) {
      throw new Error(`${definition.name}: input.${key} is not an allowed enum value`);
    }
  }
}

export async function runProjectFunction(
  projectPath: string,
  name: string,
  input: unknown,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const manifest = await readProjectFunctionsManifest(projectPath);
  if (!manifest.found) throw new Error(`project has no ${PROJECT_FUNCTIONS_REL}`);
  if (!manifest.functions) throw new Error(manifest.error ?? "invalid functions manifest");
  const definition = manifest.functions.find((candidate) => candidate.name === name);
  if (!definition) throw new Error(`unknown project function "${name}"`);
  if (!plainObject(input)) throw new Error("input must be a JSON object");
  validateInput(definition, input);
  const payload = JSON.stringify(input);
  if (Buffer.byteLength(payload) > MAX_INPUT_BYTES) throw new Error(`project function input exceeds ${MAX_INPUT_BYTES} bytes`);

  return new Promise((resolve) => {
    const child = spawn(definition.command[0], definition.command.slice(1), {
      cwd: projectPath,
      env: { ...childEnv(), MSO_PROJECT_FUNCTION: definition.name } as unknown as NodeJS.ProcessEnv,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;
    let stdout = "", stderr = "", stdoutBytes = 0, stderrBytes = 0;
    let finished = false, overflow = false, timedOut = false;
    const append = (current: string, bytes: number, chunk: Buffer): [string, number] => {
      const slice = chunk.subarray(0, Math.max(0, MAX_OUTPUT_BYTES - bytes));
      return [current + slice.toString("utf8"), bytes + slice.byteLength];
    };
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdoutBytes + chunk.byteLength > MAX_OUTPUT_BYTES) overflow = true;
      [stdout, stdoutBytes] = append(stdout, stdoutBytes, chunk);
      if (overflow) child.kill("SIGTERM");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderrBytes + chunk.byteLength > MAX_OUTPUT_BYTES) overflow = true;
      [stderr, stderrBytes] = append(stderr, stderrBytes, chunk);
      if (overflow) child.kill("SIGTERM");
    });
    const timer = setTimeout(() => { if (!finished) { timedOut = true; child.kill("SIGTERM"); } }, definition.timeoutMs);
    child.on("error", (error: Error) => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: `${stderr}${stderr ? "\n" : ""}${error.message}` });
    });
    child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      const note = overflow ? "output exceeded limit" : timedOut ? `timed out after ${definition.timeoutMs}ms` : signal ? `terminated by ${signal}` : "";
      resolve({ code: overflow || timedOut ? 1 : (code ?? 1), stdout,
        stderr: `${stderr}${note ? `${stderr ? "\n" : ""}${note}` : ""}` });
    });
    child.stdin.end(payload);
  });
}
