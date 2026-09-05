import { createHash, randomBytes } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import path from "node:path";
import { withSecurityStoreLock } from "@/lib/security-store-lock";
import { getInfraProviderDefinition, isInfraProviderId, normalizeInfraValues } from "./catalog";
import { doctorInfraProvider } from "./clients";
import { INFRA_STORE_PATH, readInfraProvider, setInfraProvider } from "./store";
import { setupFields, setupGuidance, setupMethod, type SetupMethod } from "./setup-guidance";
import type { InfraProviderId } from "./types";

export const SETUP_TTL_MS = 10 * 60_000;
export const SETUP_MAX_BODY = 16 * 1024;
const ROOT = path.join(path.dirname(INFRA_STORE_PATH), "integration-setup");
type Grant = { provider: InfraProviderId; method: SetupMethod; principal: string; expiresAt: number; attempts: number; used: boolean };
export class SetupError extends Error {
  constructor(public readonly code: string, public readonly status: number) { super(code); }
}
const invalid = () => new SetupError("setup_expired_or_invalid", 401);
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
async function ensureRoot() {
  await fs.mkdir(ROOT, { recursive: true, mode: 0o700 });
  const st = await fs.lstat(ROOT);
  if (!st.isDirectory() || st.isSymbolicLink() || (typeof process.getuid === "function" && st.uid !== process.getuid())) throw invalid();
  await fs.chmod(ROOT, 0o700);
}
function grantPath(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw invalid();
  return path.join(ROOT, `${hash(token)}.json`);
}
async function readGrant(file: string): Promise<Grant> {
  let handle;
  try {
    handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const st = await handle.stat();
    if (!st.isFile() || st.size > 2048 || (st.mode & 0o077) || (typeof process.getuid === "function" && st.uid !== process.getuid())) throw invalid();
    const g = JSON.parse(await handle.readFile("utf8")) as Grant;
    if (!isInfraProviderId(g.provider) || !g.principal || !Number.isFinite(g.expiresAt)) throw invalid();
    setupMethod(g.provider, g.method);
    return g;
  } catch { throw invalid(); } finally { await handle?.close(); }
}
function active(g: Grant) { if (g.used || g.attempts >= 5 || g.expiresAt <= Date.now()) throw invalid(); }
async function schema(g: Grant) {
  const stored = await readInfraProvider(g.provider);
  return {
    provider: g.provider, title: getInfraProviderDefinition(g.provider).title, method: g.method,
    expiresAt: g.expiresAt, store: "MSO private credentials · owner-only permissions (0600)",
    fields: setupFields(g.provider, g.method).map(f => ({ ...f, stored: Boolean(stored[f.key]) })),
    guidance: setupGuidance(g.provider, g.method),
  };
}
export async function openIntegrationSetup(provider: string, principal: string, method?: string) {
  if (!isInfraProviderId(provider)) throw new SetupError("unknown_provider", 400);
  if (!principal || principal.length > 256) throw new SetupError("authenticated_principal_required", 403);
  const selectedMethod = setupMethod(provider, method);
  await ensureRoot();
  return withSecurityStoreLock(path.join(ROOT, "issuance"), async () => {
    let activeCount = 0;
    for (const name of await fs.readdir(ROOT)) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      const file = path.join(ROOT, name), previous = await readGrant(file);
      if (previous.used || previous.expiresAt <= Date.now()) await fs.unlink(file);
      else activeCount++;
    }
    if (activeCount >= 256) throw new SetupError("too_many_setup_sessions", 429);
    const token = randomBytes(32).toString("base64url");
    const grant: Grant = { provider, principal, method: selectedMethod, expiresAt: Date.now() + SETUP_TTL_MS, attempts: 0, used: false };
    const descriptor = await schema(grant);
    await fs.writeFile(grantPath(token), JSON.stringify(grant), { mode: 0o600, flag: "wx" });
    return { token, setup: descriptor };
  });
}
export async function describeIntegrationSetup(token: string) {
  const grant = await readGrant(grantPath(token)); active(grant); return schema(grant);
}
export async function consumeIntegrationSetup(token: string, raw: unknown) {
  const file = grantPath(token);
  return withSecurityStoreLock(file, async () => {
    const grant = await readGrant(file); active(grant);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new SetupError("invalid_fields", 400);
    const fields = setupFields(grant.provider, grant.method), allowed = new Set(fields.map(f => f.key));
    for (const [key, value] of Object.entries(raw)) {
      if (!allowed.has(key) || typeof value !== "string" || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value)) throw new SetupError("invalid_fields", 400);
    }
    let updates;
    try { updates = normalizeInfraValues(grant.provider, raw as Record<string, unknown>); }
    catch { throw new SetupError("invalid_credential_format", 400); }
    if (!Object.keys(updates).length) throw new SetupError("enter_at_least_one_value", 400);
    const stored = await readInfraProvider(grant.provider);
    const candidate = Object.fromEntries(fields.filter(f => updates[f.key] || stored[f.key]).map(f => [f.key, updates[f.key] ?? stored[f.key]]));
    if (fields.some(f => f.required && !candidate[f.key])) throw new SetupError("required_fields_missing", 400);
    grant.attempts++;
    await fs.writeFile(file, JSON.stringify(grant), { mode: 0o600 });
    // Probe candidate values before mutating the real store. Only safe enums/status
    // escape this boundary, never provider response text or credential values.
    const result = await doctorInfraProvider(grant.provider, candidate);
    if (result.ok !== true) throw new SetupError(result.ok === null ? "live_validation_unavailable" : "credential_validation_failed", 422);
    if (grant.expiresAt <= Date.now()) throw invalid();
    grant.used = true;
    await fs.writeFile(file, JSON.stringify(grant), { mode: 0o600 });
    await setInfraProvider(grant.provider, updates);
    return { ok: true, verified: true, provider: grant.provider, principal: grant.principal };
  });
}
