import { ApiError } from "../host-api.ts";
import { detectShellBridge, type ShellBridge } from "../shell-bridge.ts";
import { canonicalProviderId } from "./integrations-schema.ts";
import { isNonEmpty, isRecord, requestJson } from "./integrations-workspace-api.ts";

export type TransferConnectionPreview = { id: string; label: string; source: string; storedFields: number };
export type TransferProviderPreview = { id: string; title: string; connections: TransferConnectionPreview[] };
export type TransferUserPreview = { id: string; label: string; providers: TransferProviderPreview[] };

export type TransferExportPreview = {
  mode: string; users: number; connections: number; json: string; truncated: boolean;
};
export type TransferImportPreview = {
  planId: string; canApply: boolean; connections: number; createUsers: number;
  warnings: number; requiresWarningAcceptance: boolean;
};

/** A metadata bundle never carries a credential value, but redact defensively: an upstream
 *  regression must not turn the preview panel into a secret-rendering surface. */
const SECRET_KEY = /^(values?|secrets?|secretValue|password|passphrase|token|apiKey|apiToken|accessToken|refreshToken|authorization|headers|clientSecret|grant)$/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 10) return null;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = SECRET_KEY.test(key) ? "[redacted]" : redact(item, depth + 1);
  }
  return out;
}

export async function readTransferTree(
  signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<TransferUserPreview[]> {
  const payload = await requestJson("/api/v1/integrations/transfer", {
    method: "POST", label: "Transfer preview", body: { action: "tree" },
  }, signal, fetcher, bridge);
  if (!isRecord(payload) || !Array.isArray(payload.users)) {
    throw new ApiError("The MSO transfer response is invalid.", 502);
  }
  return payload.users.map((user) => {
    if (!isRecord(user) || !isNonEmpty(user.id) || !Array.isArray(user.providers)) {
      throw new ApiError("The MSO transfer response is invalid.", 502);
    }
    return {
      id: user.id, label: isNonEmpty(user.label) ? user.label : user.id,
      providers: user.providers.map((provider) => {
        if (!isRecord(provider) || !isNonEmpty(provider.id) || !Array.isArray(provider.connections)) {
          throw new ApiError("The MSO transfer response is invalid.", 502);
        }
        return {
          id: canonicalProviderId(provider.id), title: isNonEmpty(provider.title) ? provider.title : provider.id,
          connections: provider.connections.map((connection) => {
            if (!isRecord(connection) || !isNonEmpty(connection.id)) {
              throw new ApiError("The MSO transfer response is invalid.", 502);
            }
            return {
              id: connection.id, label: isNonEmpty(connection.label) ? connection.label : connection.id,
              source: typeof connection.source === "string" ? connection.source : "direct",
              storedFields: typeof connection.storedFields === "number" ? connection.storedFields : 0,
            };
          }),
        };
      }),
    };
  });
}

const PREVIEW_LIMIT = 6000;

export async function prepareTransferExport(
  signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<TransferExportPreview> {
  const payload = await requestJson("/api/v1/integrations/transfer", {
    method: "POST", label: "Transfer export", timeoutMs: 30_000, body: { action: "export" },
  }, signal, fetcher, bridge);
  if (!isRecord(payload) || !isRecord(payload.bundle)) {
    throw new ApiError("The MSO transfer response is invalid.", 502);
  }
  const bundle = payload.bundle;
  if (bundle.mode !== "metadata") {
    throw new ApiError(
      "Encrypted bundles cannot be previewed here. Export them from the terminal so the passphrase never enters the shell.", 409,
    );
  }
  const users = Array.isArray(bundle.users) ? bundle.users : [];
  let connections = 0;
  for (const user of users) {
    if (!isRecord(user) || !Array.isArray(user.connections)) continue;
    const rows = user.connections.length;
    connections += rows;
  }
  const text = JSON.stringify(redact(bundle), null, 2);
  return {
    mode: "metadata", users: users.length, connections,
    json: text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT)}\n… truncated` : text,
    truncated: text.length > PREVIEW_LIMIT,
  };
}

export async function previewTransferImport(
  document: unknown, signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<TransferImportPreview> {
  const payload = await requestJson("/api/v1/integrations/transfer", {
    method: "POST", label: "Transfer import preview", timeoutMs: 30_000,
    body: { action: "import", document, apply: false },
  }, signal, fetcher, bridge);
  if (!isRecord(payload) || !Array.isArray(payload.connections) || !Array.isArray(payload.createUsers)) {
    throw new ApiError("The MSO transfer response is invalid.", 502);
  }
  return {
    planId: isNonEmpty(payload.planId) ? payload.planId : "",
    canApply: payload.canApply === true,
    connections: payload.connections.length,
    createUsers: payload.createUsers.length,
    warnings: Array.isArray(payload.warnings) ? payload.warnings.length : 0,
    requiresWarningAcceptance: payload.requiresWarningAcceptance === true,
  };
}

/** Parse pasted bundle JSON locally before it reaches the server, so malformed text
 *  fails in the browser with a field error instead of a generic request failure. */
export function parseTransferDocument(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new ApiError("Paste a bundle document first.", 400);
  if (trimmed.length > 1024 * 1024) throw new ApiError("This document is larger than the 1 MiB bundle limit.", 413);
  let parsed: unknown;
  try { parsed = JSON.parse(trimmed); } catch { throw new ApiError("This document is not valid JSON.", 400); }
  if (!isRecord(parsed)) throw new ApiError("A bundle document must be a JSON object.", 400);
  return parsed;
}
