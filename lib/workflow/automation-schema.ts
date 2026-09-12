import type { AutomationFlow, FlowInput, FlowStep } from "@/lib/contracts/automation";

function metadataOnly(value: unknown, depth = 0): void {
  if (depth > 12) throw new Error("flow metadata too deep");
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (/^(secrets?|secretValue|password|passphrase|token|apiKey|apiToken|accessToken|refreshToken|authorization|headers|__proto__|constructor|prototype)$/i.test(key)) throw new Error("secret_input_forbidden");
    metadataOnly(child, depth + 1);
  }
}
const NAME = /^[a-z][a-z0-9_-]{0,63}$/;
const ID = /^[a-z][a-z0-9_.-]{0,63}$/;
const TOOLS = new Set(["integration_execute", "project_mcp_call", "project_function_call"]);
const TYPES = new Set(["string", "number", "integer", "boolean", "object", "array"]);
export const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
function keys(value: Record<string, unknown>, allowed: string[]) {
  const invalid = Object.keys(value).find(k => !allowed.includes(k));
  if (invalid) throw new Error("unknown flow field: " + invalid);
}
function text(v: unknown, max: number): v is string { return typeof v === "string" && v.trim().length > 0 && v.length <= max; }
export function parseFlow(raw: unknown): AutomationFlow {
  if (!object(raw) || Buffer.byteLength(JSON.stringify(raw)) > 64 * 1024) throw new Error("flow must be an object up to 64 KiB");
  keys(raw, ["id", "description", "inputs", "steps"]);
  if (!text(raw.id, 64) || !ID.test(raw.id) || !text(raw.description, 600)) throw new Error("flow id/description invalid");
  if (!object(raw.inputs) || Object.keys(raw.inputs).length > 32) throw new Error("flow inputs must have at most 32 fields");
  metadataOnly(raw);
  for (const [name, field] of Object.entries(raw.inputs)) {
    if (!NAME.test(name) || !object(field)) throw new Error("invalid flow input: " + name);
    keys(field, ["type", "description", "required", "default", "enum"]);
    if (!TYPES.has(String(field.type)) || !text(field.description, 300)) throw new Error("invalid input type/description: " + name);
    if (field.default !== undefined && !matches(field as FlowInput, field.default)) throw new Error("default does not match input type");
    if (field.required !== undefined && typeof field.required !== "boolean") throw new Error("invalid required flag");
    if (field.enum !== undefined && (!Array.isArray(field.enum) || field.enum.length > 64 ||
      field.enum.some(v => !["string", "number", "boolean"].includes(typeof v)))) throw new Error("invalid input enum");
  }
  if (!Array.isArray(raw.steps) || !raw.steps.length || raw.steps.length > 12) throw new Error("flow needs 1-12 steps");
  const inputNames = new Set(Object.keys(raw.inputs));
  const seen = new Set<string>();
  for (const step of raw.steps) {
    if (!object(step)) throw new Error("invalid flow step");
    keys(step, ["id", "tool", "arguments", "expect"]);
    if (!text(step.id, 64) || !NAME.test(step.id) || seen.has(step.id) || !TOOLS.has(String(step.tool)) || !object(step.arguments)) throw new Error("invalid/duplicate flow step");
    function references(value: unknown) {
      if (!value || typeof value !== "object") return;
      if (object(value) && Object.hasOwn(value, "$ref")) {
        if (Object.keys(value).length !== 1 || typeof value.$ref !== "string") throw new Error("invalid flow reference");
        const [kind, name, ...tail] = value.$ref.split(".");
        if (kind === "project" ? name !== undefined : kind === "input" ? !name || !inputNames.has(name) : kind === "steps" ? !name || !seen.has(name) : true) throw new Error("unknown or forward flow reference");
        if (tail.some(k => !/^[A-Za-z0-9_-]+$/.test(k) || ["__proto__", "constructor", "prototype"].includes(k))) throw new Error("invalid flow reference");
        return;
      }
      Object.values(value).forEach(references);
    }
    references(step.arguments);
    seen.add(step.id);
    if (Object.hasOwn(step.arguments, "workflow_id")) throw new Error("flow steps inherit workflow_id");
    if (step.expect !== undefined) {
      if (!object(step.expect)) throw new Error("invalid flow expectation");
      keys(step.expect, ["path", "equals"]);
      if (!text(step.expect.path, 256) || !Object.hasOwn(step.expect, "equals")) throw new Error("invalid flow expectation");
    }
  }
  return raw as unknown as AutomationFlow;
}
export function flowInputSchema(flow: AutomationFlow) {
  return { type: "object", additionalProperties: false,
    properties: Object.fromEntries(Object.entries(flow.inputs).map(([name, { required: _required, ...field }]) => [name, field])),
    required: Object.entries(flow.inputs).filter(([,field]) => field.required).map(([name]) => name) };
}
function matches(field: FlowInput, value: unknown): boolean {
  return field.type === "object" ? object(value) : field.type === "array" ? Array.isArray(value) :
    field.type === "integer" ? typeof value === "number" && Number.isSafeInteger(value) :
    field.type === "number" ? typeof value === "number" && Number.isFinite(value) : typeof value === field.type;
}
export function flowInputs(flow: AutomationFlow, raw: unknown): Record<string, unknown> {
  if (!object(raw) || Buffer.byteLength(JSON.stringify(raw)) > 32 * 1024) throw new Error("flow input must be an object up to 32 KiB");
  metadataOnly(raw); keys(raw, Object.keys(flow.inputs));
  const input = { ...raw };
  for (const [name, field] of Object.entries(flow.inputs)) {
    if (!Object.hasOwn(input, name) && field.default !== undefined) input[name] = field.default;
    if (input[name] === undefined) { if (field.required) throw new Error("missing input." + name); continue; }
    if (!matches(field, input[name]) || (field.enum && !field.enum.includes(input[name] as string))) throw new Error("invalid input." + name);
  }
  return input;
}
export function flowValue(root: unknown, path: string): unknown {
  let value = root;
  const parts = path.split(".");
  if (parts.length > 12 || parts.some(key => !/^[A-Za-z0-9_-]+$/.test(key) || ["__proto__", "constructor", "prototype"].includes(key))) throw new Error("invalid flow reference");
  for (const key of parts) {
    if ((!object(value) && !Array.isArray(value)) || !Object.hasOwn(value, key)) throw new Error("unresolved flow reference: " + path);
    value = (value as Record<string, unknown>)[key];
  }
  return structuredClone(value);
}
export function bindFlowValue(value: unknown, context: unknown, depth = 0): unknown {
  if (depth > 12) throw new Error("flow references too deep");
  if (Array.isArray(value)) return value.map(v => bindFlowValue(v, context, depth + 1));
  if (!object(value)) return value;
  if (Object.hasOwn(value, "$ref")) {
    if (Object.keys(value).length !== 1 || typeof value.$ref !== "string") throw new Error("flow $ref must be the whole value");
    return flowValue(context, value.$ref);
  }
  return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, bindFlowValue(v, context, depth + 1)]));
}
export function flowStepArgs(step: FlowStep, context: { input: unknown; steps: unknown; project: string }, workflowId?: string) {
  const args = bindFlowValue(step.arguments, context) as Record<string, unknown>;
  if (step.tool.startsWith("project_")) {
    if (args.project !== undefined && args.project !== context.project) throw new Error("flow step cannot switch project");
    args.project = context.project;
  }
  if (workflowId) args.workflow_id = workflowId;
  return args;
}
