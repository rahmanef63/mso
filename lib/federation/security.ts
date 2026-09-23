export const FEDERATION_WORKER_ID = "batonly-federation";
export const MAX_FEDERATION_ARGUMENT_BYTES = 32 * 1024;
export const MAX_FEDERATION_RESULT_BYTES = 64 * 1024;
const MAX_DEPTH = 8;
const MAX_KEYS = 80;
const MAX_ITEMS = 100;
const MAX_STRING = 8192;

const SECRET_VALUE = /^(?:Bearer\s+|Basic\s+|gh[pousr]_|github_pat_|sk-[A-Za-z0-9]|-----BEGIN [A-Z ]*PRIVATE KEY-----|mso_mcp_)/i;
const SENSITIVE_KEYS = new Set([
  "authorization","header","headers","bearer","cookie","credential","credentials",
  "password","passwd","privatekey","secret","secretvalue","token","apikey","apitoken",
  "accesstoken","refreshtoken","clientsecret",
]);
const sensitiveKey = (key: string) => SENSITIVE_KEYS.has(key.replace(/[_.-]/g, "").toLowerCase());

const plainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

function encodedBytes(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function validateValue(value: unknown, path: string, depth: number): void {
  if (depth > MAX_DEPTH) throw new Error("federation arguments are too deeply nested");
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${path} must be a finite number`);
    return;
  }
  if (typeof value === "string") {
    if (value.length > MAX_STRING) throw new Error(`${path} exceeds ${MAX_STRING} characters`);
    if (SECRET_VALUE.test(value.trim())) throw new Error(`${path} looks like a credential; use a named connection`);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ITEMS) throw new Error(`${path} has too many items`);
    value.forEach((item, index) => validateValue(item, `${path}[${index}]`, depth + 1));
    return;
  }
  if (!plainObject(value)) throw new Error(`${path} contains an unsupported value`);
  const entries = Object.entries(value);
  if (entries.length > MAX_KEYS) throw new Error(`${path} has too many fields`);
  for (const [key, item] of entries) {
    if (!key || key.length > 120) throw new Error(`${path} contains an invalid field name`);
    if (sensitiveKey(key)) throw new Error(`${path}.${key} is credential-shaped; use a named connection`);
    validateValue(item, `${path}.${key}`, depth + 1);
  }
}

export function validateFederationArguments(value: unknown): Record<string, unknown> {
  if (!plainObject(value)) throw new Error("federation arguments must be an object");
  validateValue(value, "arguments", 0);
  if (encodedBytes(value) > MAX_FEDERATION_ARGUMENT_BYTES) throw new Error("federation arguments exceed 32 KiB");
  return value;
}

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[truncated-depth]";
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") {
    if (SECRET_VALUE.test(value.trim())) return "[redacted]";
    return value.length > MAX_STRING ? value.slice(0, MAX_STRING) + "…" : value;
  }
  if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map((item) => sanitize(item, depth + 1));
  if (!plainObject(value)) return String(value);
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, MAX_KEYS)) {
    out[key] = sensitiveKey(key) ? "[redacted]" : sanitize(item, depth + 1);
  }
  return out;
}

export function safeFederationResult(value: unknown): { value: unknown; json: string; truncated: boolean } {
  const safe = sanitize(value);
  let json = JSON.stringify(safe);
  if (Buffer.byteLength(json, "utf8") <= MAX_FEDERATION_RESULT_BYTES) return { value: safe, json, truncated: false };
  const fallback = { truncated: true, summary: "Result exceeded the federation evidence budget." };
  json = JSON.stringify(fallback);
  return { value: fallback, json, truncated: true };
}

export function safeFederationError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  const clean = String(sanitize(raw));
  return clean.length <= 1000 ? clean : clean.slice(0, 999) + "…";
}

export function parseBatonMcpResult(value: unknown): unknown {
  if (!plainObject(value)) return value;
  const content = value.content;
  if (!Array.isArray(content)) return value;
  const text = content.find((row) => plainObject(row) && row.type === "text" && typeof row.text === "string") as { text?: string } | undefined;
  if (!text?.text) return value;
  try { return JSON.parse(text.text); } catch { return text.text; }
}
