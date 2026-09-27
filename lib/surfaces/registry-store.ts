import { constants, promises as fs } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { surfaceRegistryPath } from "./config";
import { withSecurityStoreLock } from "@/lib/security-store-lock";

const MAX_BYTES = 16_384;
export class SurfaceConfigError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
export const registryRevision = (raw: string) => createHash("sha256").update(raw).digest("hex");
export async function readSurfaceRegistry() {
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
export async function mutateSurfaceRegistry(
  expectedRevision: unknown,
  update: (entries: Array<Record<string, unknown>>) => Promise<Array<Record<string, unknown>>>,
) {
  return withSecurityStoreLock(surfaceRegistryPath(), async () => {
    const current = await readSurfaceRegistry();
    if (current.managedByEnvironment) throw new SurfaceConfigError("surface_registry_managed_by_environment", 409);
    if (expectedRevision !== registryRevision(current.raw)) throw new SurfaceConfigError("surface_registry_changed_reload", 409);
    let entries: Array<Record<string, unknown>>;
    try { entries = JSON.parse(current.raw); } catch { throw new SurfaceConfigError("invalid_existing_surface_registry", 409); }
    if (!Array.isArray(entries) || entries.some(entry => !entry || typeof entry !== "object" || Array.isArray(entry))) throw new SurfaceConfigError("invalid_existing_surface_registry", 409);
    const next = await update(entries);
    const raw = JSON.stringify(next, null, 2) + "\n";
    if (next.length > 16 || Buffer.byteLength(raw) > MAX_BYTES) throw new SurfaceConfigError("surface_registry_capacity", 409);
    const file = surfaceRegistryPath(), temporary = `${file}.${randomUUID()}.tmp`;
    try { await fs.writeFile(temporary, raw, { mode: 0o600, flag: "wx" }); await fs.rename(temporary, file); }
    finally { await fs.unlink(temporary).catch(() => undefined); }
    return { revision: registryRevision(raw), configurable: true };
  });
}
