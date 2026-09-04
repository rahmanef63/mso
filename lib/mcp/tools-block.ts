import { MSO_BLOCK_URI } from "./ui-block";
import { type McpTool, READ_ONLY, S, str } from "./tool-kit";

const SCALAR_SCHEMA = {
  anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "null" }],
} as const;

const FIELD_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string", minLength: 1, maxLength: 80 },
    label: { type: "string", minLength: 1, maxLength: 160 },
    value: SCALAR_SCHEMA,
    input: { type: "string", enum: ["text", "number", "email", "url", "textarea", "boolean"] },
    editable: { type: "boolean" },
    required: { type: "boolean" },
    placeholder: { type: "string", maxLength: 240 },
  },
  required: ["id", "label"],
  additionalProperties: false,
} as const;

const CHECK_SCHEMA = {
  type: "object",
  properties: {
    label: { type: "string", minLength: 1, maxLength: 200 },
    state: { type: "string", enum: ["pass", "warn", "fail", "info"] },
    detail: { type: "string", maxLength: 500 },
  },
  required: ["label", "state"],
  additionalProperties: false,
} as const;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    label: { type: "string", minLength: 1, maxLength: 160 },
    value: SCALAR_SCHEMA,
  },
  required: ["label", "value"],
  additionalProperties: false,
} as const;

const ACTION_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string", minLength: 1, maxLength: 80 },
    label: { type: "string", minLength: 1, maxLength: 120 },
    style: { type: "string", enum: ["primary", "secondary", "danger"] },
    prompt: {
      type: "string",
      minLength: 1,
      maxLength: 1200,
      description: "Follow-up instruction sent only after the user presses this button. Normal tool scope, approval, and audit rules still apply.",
    },
    confirm: { type: "string", maxLength: 240 },
  },
  required: ["id", "label", "prompt"],
  additionalProperties: false,
} as const;

export const BLOCK_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["validation", "crud", "action"] },
    title: { type: "string" },
    description: { type: "string" },
    status: { type: "string", enum: ["neutral", "pending", "success", "warning", "error"] },
    fields: { type: "array", items: FIELD_SCHEMA },
    checks: { type: "array", items: CHECK_SCHEMA },
    outputs: { type: "array", items: OUTPUT_SCHEMA },
    actions: { type: "array", items: ACTION_SCHEMA },
  },
  required: ["kind", "title", "status", "fields", "checks", "outputs", "actions"],
  additionalProperties: false,
} as const;

const text = (value: unknown, max: number, fallback = "") => {
  if (typeof value !== "string") return fallback;
  const clean = value.trim();
  return clean ? clean.slice(0, max) : fallback;
};

const scalar = (value: unknown): string | number | boolean | null => {
  if (typeof value === "string") return value.slice(0, 2_000);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean" || value === null) return value;
  return "";
};

const choice = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === "string" && allowed.includes(value as T) ? value as T : fallback;

function rows(value: unknown, max: number): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)).slice(0, max)
    : [];
}

function normalizeBlock(input: Record<string, unknown>) {
  const fields = rows(input.fields, 20).map((field, index) => ({
    id: text(field.id, 80, `field-${index + 1}`),
    label: text(field.label, 160, `Field ${index + 1}`),
    value: scalar(field.value),
    input: choice(field.input, ["text", "number", "email", "url", "textarea", "boolean"] as const, "text"),
    editable: field.editable !== false,
    required: field.required === true,
    ...(text(field.placeholder, 240) ? { placeholder: text(field.placeholder, 240) } : {}),
  }));
  const checks = rows(input.checks, 20).map((check) => ({
    label: text(check.label, 200, "Check"),
    state: choice(check.state, ["pass", "warn", "fail", "info"] as const, "info"),
    ...(text(check.detail, 500) ? { detail: text(check.detail, 500) } : {}),
  }));
  const outputs = rows(input.outputs, 20).map((output) => ({
    label: text(output.label, 160, "Result"),
    value: scalar(output.value),
  }));
  const actions = rows(input.actions, 8).map((action, index) => ({
    id: text(action.id, 80, `action-${index + 1}`),
    label: text(action.label, 120, "Continue"),
    style: choice(action.style, ["primary", "secondary", "danger"] as const, "secondary"),
    prompt: text(action.prompt, 1_200, "Continue with the selected MSO action."),
    ...(text(action.confirm, 240) ? { confirm: text(action.confirm, 240) } : {}),
  }));

  return {
    kind: choice(input.kind, ["validation", "crud", "action"] as const, "action"),
    title: text(input.title, 240, "MSO block"),
    ...(text(input.description, 1_000) ? { description: text(input.description, 1_000) } : {}),
    status: choice(input.status, ["neutral", "pending", "success", "warning", "error"] as const, "neutral"),
    fields,
    checks,
    outputs,
    actions,
  };
}

export const BLOCK_TOOLS: McpTool[] = [
  {
    name: "render_mso_block",
    title: "Render MSO Block",
    description:
      "Render a compact MCP App block only when a visible interaction helps: validation state, action buttons, or CRUD input-output. " +
      "workflow_start is headless and never opens this automatically. Buttons send a user-approved follow-up to ChatGPT; the actual read/write/exec operation still uses the normal scoped tool, approval, and audit path. Raw HTML and arbitrary executable actions are not accepted.",
    chatgptDescription:
      "Render a compact validation/action/CRUD block. Use it only for user-facing confirmation or structured input-output; workflow_start stays invisible. Button presses return a follow-up to the chat and do not bypass tool approvals.",
    scope: "read",
    annotations: READ_ONLY,
    inputSchema: S({
      kind: { type: "string", enum: ["validation", "crud", "action"] },
      title: { type: "string", minLength: 1, maxLength: 240 },
      description: { type: "string", maxLength: 1_000 },
      status: { type: "string", enum: ["neutral", "pending", "success", "warning", "error"] },
      fields: { type: "array", maxItems: 20, items: FIELD_SCHEMA },
      checks: { type: "array", maxItems: 20, items: CHECK_SCHEMA },
      outputs: { type: "array", maxItems: 20, items: OUTPUT_SCHEMA },
      actions: { type: "array", maxItems: 8, items: ACTION_SCHEMA },
    }, ["kind", "title"]),
    outputSchema: BLOCK_OUTPUT_SCHEMA,
    meta: {
      ui: { resourceUri: MSO_BLOCK_URI, visibility: ["model", "app"] },
      "openai/outputTemplate": MSO_BLOCK_URI,
      "openai/toolInvocation/invoking": "Preparing interaction…",
      "openai/toolInvocation/invoked": "Interaction ready",
      "openai/widgetAccessible": true,
    },
    run: async (input) => normalizeBlock({ ...input, title: str(input, "title") }),
  },
];
