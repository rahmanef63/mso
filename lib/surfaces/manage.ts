import { configuredSurfaceApps } from "./config";
import { readSurfaceRegistry, registryRevision, mutateSurfaceRegistry, SurfaceConfigError } from "./registry-store";
export { SurfaceConfigError } from "./registry-store";

const APP_FIELDS = new Set(["id", "title", "description", "origin", "startPath", "renderer", "presentation", "environment", "sandbox", "externalAuthPath", "reason", "project", "placements"]);
export async function surfaceRegistrySnapshot() {
  const state = await readSurfaceRegistry();
  return { revision: registryRevision(state.raw), configurable: !state.managedByEnvironment, apps: await configuredSurfaceApps(state.raw) };
}
/** Explicit owner operation. Never accepts a filesystem path or credential values. */
export async function saveWorkflowSurface(input: Record<string, unknown>) {
  if (Object.keys(input).some((key) => !["app", "expectedRevision", "confirm"].includes(key)) || input.confirm !== true) throw new SurfaceConfigError("explicit_review_required");
  const app = input.app;
  if (!app || typeof app !== "object" || Array.isArray(app) || Object.keys(app).some((key) => !APP_FIELDS.has(key))) throw new SurfaceConfigError("invalid_surface_metadata");
  const row = app as Record<string, unknown>;
  const placement = Array.isArray(row.placements) && row.placements.length === 1 && (row.placements[0] === "workflows" || row.placements[0] === "n8n") ? row.placements[0] : undefined;
  if (row.placements !== undefined && !placement) throw new SurfaceConfigError("invalid_workflow_placement");
  const selectedPlacement = placement ?? "workflows";
  const normalized = await configuredSurfaceApps(JSON.stringify([{ ...row, placements: [selectedPlacement] }]));
  if (normalized.length !== 1) throw new SurfaceConfigError("invalid_surface_metadata");
  const selected = normalized[0];
  const result = await mutateSurfaceRegistry(input.expectedRevision, async entries => {
    const matches = entries.filter((entry) => entry.id === selected.id);
    if (matches.length > 1) throw new SurfaceConfigError("duplicate_surface_identity", 409);
    const replacement = { ...selected };
    // Missing placements is legacy Page approval only when the existing row is
    // itself a valid reviewed app. Invalid historical bytes cannot grant Page.
    const existing = matches[0];
    if (Array.isArray(existing?.placements) && existing.placements.includes("shell")) throw new SurfaceConfigError("surface_owned_by_shell", 409);
    const existingNormalized = existing ? (await configuredSurfaceApps(JSON.stringify([existing])))[0] : undefined;
    const sharesPage = Boolean(existingNormalized && (existingNormalized.placements === undefined ||
      existingNormalized.placements?.includes("mcp-page")));
    if (selected.externalAuthPath?.includes("?") && (!sharesPage ||
      selected.externalAuthPath !== existingNormalized?.externalAuthPath)) {
      throw new SurfaceConfigError("workflow_login_path_must_not_contain_query");
    }
    if (sharesPage) {
      replacement.placements = [selectedPlacement, "mcp-page"];
      if (existingNormalized?.externalAuthPath !== undefined) replacement.externalAuthPath = existingNormalized.externalAuthPath;
      else delete replacement.externalAuthPath;
    }
    const next = matches.length ? entries.map((entry) => entry.id === selected.id ? replacement : entry) : [...entries, replacement];
    return next;
  });
  return { ...result, id: selected.id };
}
