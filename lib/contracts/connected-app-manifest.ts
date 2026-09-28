/** Portable discovery metadata. Endpoints and permissions belong to each binding. */
export type ConnectedAppManifest = {
  schema: "urn:mso:connected-app:v1";
  schemaVersion: 1;
  id: string;
  version: string;
  title: string;
  description: string;
  publisher: string;
  presentation: "embed" | "tab";
};
export const CONNECTED_APP_MANIFEST_MAX_BYTES = 8192;
const KEYS = ["schema", "schemaVersion", "id", "version", "title", "description", "publisher", "presentation"];
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;
const plain = (value: unknown, max: number, empty = false): value is string =>
  typeof value === "string" && value.length <= max && (empty || value.trim().length > 0) && !/[<>\u0000-\u001f\u007f]/.test(value);

export function validateConnectedAppManifest(value: unknown): ConnectedAppManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Manifest must be a JSON object.");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== KEYS.length || Object.keys(record).some(key => !KEYS.includes(key))) throw new Error("Manifest contains missing or unsupported fields.");
  if (record.schema !== "urn:mso:connected-app:v1" || record.schemaVersion !== 1) throw new Error("Unsupported connected app manifest version.");
  if (typeof record.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(record.id)) throw new Error("Manifest ID must use lowercase letters, numbers and hyphens.");
  if (typeof record.version !== "string" || record.version.length > 128 || !VERSION.test(record.version)) throw new Error("Manifest needs a semantic version, such as 1.0.0.");
  if (!plain(record.title, 120) || !plain(record.description, 240, true) || !plain(record.publisher, 120)) throw new Error("Manifest title, description and publisher must be bounded plain text.");
  if (record.presentation !== "embed" && record.presentation !== "tab") throw new Error("Manifest presentation must be embed or tab.");
  return { schema: record.schema, schemaVersion: 1, id: record.id, version: record.version,
    title: record.title.trim(), description: record.description.trim(), publisher: record.publisher.trim(), presentation: record.presentation };
}
export function parseConnectedAppManifest(raw: string): ConnectedAppManifest {
  if (new TextEncoder().encode(raw).byteLength > CONNECTED_APP_MANIFEST_MAX_BYTES) throw new Error("Manifest exceeds the 8 KiB limit.");
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("Manifest is not valid JSON."); }
  return validateConnectedAppManifest(value);
}
