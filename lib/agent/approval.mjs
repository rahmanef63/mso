import { createHash } from "node:crypto";

export const MAX_AGENT_APPROVAL_BYTES = 32 * 1024;

function canonicalize(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("agent approval payload contains a non-finite number");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out = Object.create(null);
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  throw new Error(`agent approval payload is not JSON-safe: ${typeof value}`);
}

export function canonicalAgentApproval(name, input) {
  const payload = canonicalize({ name: String(name), input: input ?? {} });
  const canonical = JSON.stringify(payload);
  const bytes = Buffer.byteLength(canonical, "utf8");
  if (bytes > MAX_AGENT_APPROVAL_BYTES) {
    throw new Error(`tool call is ${bytes} bytes; safe terminal approval is limited to ${MAX_AGENT_APPROVAL_BYTES} bytes`);
  }
  return {
    payload,
    canonical,
    display: JSON.stringify(payload, null, 2),
    digest: createHash("sha256").update(canonical).digest("hex"),
    bytes,
  };
}

export function matchesAgentApproval(name, input, digest) {
  if (typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest)) return false;
  try {
    return canonicalAgentApproval(name, input).digest === digest;
  } catch {
    return false;
  }
}
