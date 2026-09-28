import { validateConnectedAppManifest, type ConnectedAppManifest } from "./connected-app-manifest";
import { MANAGED_APP_IDS, type ManagedAppId } from "@/lib/managed-apps/types";

export const APP_CATALOG_URL = "https://manef.dev/catalog/v1.json";
export const APP_CATALOG_MAX_BYTES = 32_768;

export type AppCatalogEntry =
  | { kind: "managed"; id: ManagedAppId }
  | { kind: "connected"; manifest: ConnectedAppManifest };

export type AppCatalog = {
  schema: "urn:manef:app-catalog:v1";
  schemaVersion: 1;
  entries: AppCatalogEntry[];
};

function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Catalog entry must be an object.");
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).length !== keys.length || Object.keys(candidate).some(key => !keys.includes(key))) {
    throw new Error("Catalog contains missing or unsupported fields.");
  }
  return candidate;
}

export function parseAppCatalog(raw: string): AppCatalog {
  if (new TextEncoder().encode(raw).byteLength > APP_CATALOG_MAX_BYTES) throw new Error("Catalog exceeds 32 KiB.");
  let input: unknown;
  try { input = JSON.parse(raw); } catch { throw new Error("Catalog is not valid JSON."); }
  const root = record(input, ["schema", "schemaVersion", "entries"]);
  if (root.schema !== "urn:manef:app-catalog:v1" || root.schemaVersion !== 1) throw new Error("Unsupported catalog version.");
  if (!Array.isArray(root.entries) || root.entries.length > 32) throw new Error("Catalog has too many entries.");
  const ids = new Set<string>();
  const entries: AppCatalogEntry[] = root.entries.map(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid catalog entry.");
    const kind = (value as Record<string, unknown>).kind;
    let entry: AppCatalogEntry;
    if (kind === "managed") {
      const item = record(value, ["kind", "id"]);
      if (typeof item.id !== "string" || !(MANAGED_APP_IDS as readonly string[]).includes(item.id)) {
        throw new Error("Catalog references an unknown managed adapter.");
      }
      entry = { kind: "managed", id: item.id as ManagedAppId };
    } else if (kind === "connected") {
      const item = record(value, ["kind", "manifest"]);
      entry = { kind: "connected", manifest: validateConnectedAppManifest(item.manifest) };
    } else throw new Error("Unsupported catalog entry kind.");
    const id = entry.kind === "managed" ? entry.id : entry.manifest.id;
    if (ids.has(id)) throw new Error("Duplicate catalog ID.");
    ids.add(id);
    return entry;
  });
  return { schema: "urn:manef:app-catalog:v1", schemaVersion: 1, entries };
}
