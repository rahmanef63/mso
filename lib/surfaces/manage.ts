import { constants, promises as fs } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { configuredSurfaceApps, surfaceRegistryPath } from "./config";
import { withSecurityStoreLock } from "@/lib/security-store-lock";

const MAX_BYTES = 16_384;
const APP_FIELDS = new Set(["id", "title", "description", "origin", "startPath", "renderer", "presentation", "environment", "sandbox", "externalAuthPath", "reason", "project", "placements"]);
export class SurfaceConfigError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
async function readRegistry() {
  const env = process.env.MSO_SURFACE_APPS_JSON;
  if (env !== undefined) return { raw: env, managedByEnvironment: true };
  let handle;
  try {
    handle = await fs.open(/* turbopackIgnore: true */ surfaceRegistryPath(), constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_BYTES || stat.uid !== process.getuid?.()) throw new SurfaceConfigError("unsafe_surface_registry", 409);
    return { raw: await handle.readFile("utf8"), managedByEnvironment: false };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { raw: "[]", managedByEnvironment: false };
    throw error;
  } finally { await handle?.close(); }
}
const revision = (raw: string) => createHash("sha256").update(raw).digest("hex");
export async function surfaceRegistrySnapshot() {
  const state = await readRegistry();
  return { revision: revision(state.raw), configurable: !state.managedByEnvironment, apps: await configuredSurfaceApps(state.raw) };
}
/** Explicit owner operation. Never accepts a filesystem path or credential values. */
export async function saveWorkflowSurface(input: Record<string, unknown>) {
  if (Object.keys(input).some((key) => !["app", "expectedRevision", "confirm"].includes(key)) || input.confirm !== true) throw new SurfaceConfigError("explicit_review_required");
  const app = input.app;
  if (!app || typeof app !== "object" || Array.isArray(app) || Object.keys(app).some((key) => !APP_FIELDS.has(key))) throw new SurfaceConfigError("invalid_surface_metadata");
  const row = app as Record<string, unknown>;
  if (row.placements !== undefined && JSON.stringify(row.placements) !== JSON.stringify(["workflows"])) throw new SurfaceConfigError("invalid_workflow_placement");
  const normalized = await configuredSurfaceApps(JSON.stringify([{ ...row, placements: ["workflows"] }]));
  if (normalized.length !== 1) throw new SurfaceConfigError("invalid_surface_metadata");
  const selected = normalized[0];
  return withSecurityStoreLock(surfaceRegistryPath(), async () => {
    const current = await readRegistry();
    if (current.managedByEnvironment) throw new SurfaceConfigError("surface_registry_managed_by_environment", 409);
    if (input.expectedRevision !== revision(current.raw)) throw new SurfaceConfigError("surface_registry_changed_reload", 409);
    let entries: Array<Record<string, unknown>>;
    try { entries = JSON.parse(current.raw); } catch { throw new SurfaceConfigError("invalid_existing_surface_registry", 409); }
    if (!Array.isArray(entries) || entries.some((entry) => !entry || typeof entry !== "object" || Array.isArray(entry))) throw new SurfaceConfigError("invalid_existing_surface_registry", 409);
    const matches = entries.filter((entry) => entry.id === selected.id);
    if (matches.length > 1) throw new SurfaceConfigError("duplicate_surface_identity", 409);
    const replacement = { ...selected };
    // Missing placements is legacy Page approval only when the existing row is
    // itself a valid reviewed app. Invalid historical bytes cannot grant Page.
    const existing = matches[0];
    const existingNormalized = existing ? (await configuredSurfaceApps(JSON.stringify([existing])))[0] : undefined;
    const sharesPage = Boolean(existingNormalized && (existingNormalized.placements === undefined ||
      existingNormalized.placements?.includes("mcp-page")));
    if (selected.externalAuthPath?.includes("?") && (!sharesPage ||
      selected.externalAuthPath !== existingNormalized?.externalAuthPath)) {
      throw new SurfaceConfigError("workflow_login_path_must_not_contain_query");
    }
    if (sharesPage) {
      replacement.placements = ["workflows", "mcp-page"];
      if (existingNormalized?.externalAuthPath !== undefined) replacement.externalAuthPath = existingNormalized.externalAuthPath;
      else delete replacement.externalAuthPath;
    }
    const next = matches.length ? entries.map((entry) => entry.id === selected.id ? replacement : entry) : [...entries, replacement];
    const raw = JSON.stringify(next, null, 2) + "\n";
    if (next.length > 16 || Buffer.byteLength(raw) > MAX_BYTES) throw new SurfaceConfigError("surface_registry_capacity", 409);
    const file = surfaceRegistryPath(), temporary = `${file}.${randomUUID()}.tmp`;
    try { await fs.writeFile(temporary, raw, { mode: 0o600, flag: "wx" }); await fs.rename(temporary, file); }
    finally { await fs.unlink(temporary).catch(() => undefined); }
    return { revision: revision(raw), configurable: true, id: selected.id };
  });
}
