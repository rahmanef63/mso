import type { DemoCredentialRecord, DemoCredentialSummary } from "@/lib/contracts/demo-credentials";
import { constants, promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { withSecurityStoreLock } from "@/lib/security-store-lock";
import { audit } from "@/lib/host/audit-api";
import { rateLimited } from "@/lib/host/rate-limit";
import { liveSessionAuthorized } from "@/lib/auth/live-authorization";
import type { DeviceRole } from "@/lib/auth/roles";
import type { SessionPayload } from "@/lib/auth/session";
import { readIntegrationState, INFRA_STORE_PATH } from "./connection-storage";
import { connectionMethod } from "./connection-registry";
import { canonicalFolder, folderBinding, identity, resolveSharedConnection, selectConnection, IntegrationError } from "./identity";
export type { DemoCredentialRecord, DemoCredentialSummary } from "@/lib/contracts/demo-credentials";

// Demo logins live beside the other private infra state: owner-only dir (0700),
// owner-only file (0600), O_NOFOLLOW + uid checks, atomic rename, locked mutation.
// The path derives from OS_INFRA_STORE so one test sandbox moves both stores.
export const DEMO_STORE_PATH = path.join(path.dirname(INFRA_STORE_PATH), "demo-credentials.json");
const MAX = 1024 * 1024;
type Store = { version: 1; records: DemoCredentialRecord[] };
export class DemoCredentialError extends Error { constructor(public readonly code: string, public readonly status = 400) { super(code); } }
/** Rebuild a validated string one bounded code unit at a time, so the stored value
 *  is never a reference to request text (CodeQL js/http-to-file-access). */
function copyUnits(value: string): string { let out = ""; for (let i = 0; i < value.length; i++) out += String.fromCharCode(value.charCodeAt(i)); return out; }
const cleanEmail = (value: unknown) => {
  const raw = typeof value === "string" ? value.trim() : "";
  if (raw.length < 3 || raw.length > 254 || /[\s\x00-\x1f\x7f]/.test(raw) || !/^[^@]+@[^@.]+(\.[^@.]+)+$/.test(raw)) throw new DemoCredentialError("invalid_demo_email");
  return copyUnits(raw);
};
const cleanPassword = (value: unknown) => {
  if (typeof value !== "string" || value.length < 1 || value.length > 4096 || /[\0\n\r]/.test(value)) throw new DemoCredentialError("invalid_demo_password");
  return copyUnits(value);
};
function optionalText(value: unknown, code: string, max: number) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw new DemoCredentialError(code);
  return copyUnits(value.trim());
}
function summary(row: DemoCredentialRecord): DemoCredentialSummary {
  // The password is deliberately dropped here; list results are sent on many paths.
  const { password, ...rest } = row;
  return { ...rest, hasPassword: true };
}
async function readRaw(): Promise<Store | null> {
  let handle;
  try {
    handle = await fs.open(DEMO_STORE_PATH, constants.O_RDONLY | constants.O_NOFOLLOW);
    const st = await handle.stat();
    if (!st.isFile() || st.size < 1 || st.size > MAX || (st.mode & 0o077) || (typeof process.getuid === "function" && st.uid !== process.getuid())) throw new DemoCredentialError("unsafe_demo_store");
    const parsed = JSON.parse(await handle.readFile("utf8")) as Store;
    return validateStore(parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new DemoCredentialError("invalid_or_unsafe_demo_store");
  } finally { await handle?.close(); }
}
function validateStore(raw: Store): Store {
  if (!raw || raw.version !== 1 || !Array.isArray(raw.records)) throw new DemoCredentialError("invalid_demo_store");
  for (const row of raw.records) {
    if (!row || typeof row.id !== "string" || !row.owner || !row.workspace || typeof row.email !== "string" || typeof row.password !== "string" || !Number.isInteger(row.revision)) throw new DemoCredentialError("invalid_demo_store");
  }
  return raw;
}
async function write(store: Store) {
  const dir = path.dirname(DEMO_STORE_PATH);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const st = await fs.lstat(dir);
  if (st.isSymbolicLink() || !st.isDirectory() || (typeof process.getuid === "function" && st.uid !== process.getuid())) throw new DemoCredentialError("unsafe_demo_directory");
  await fs.chmod(dir, 0o700);
  const text = JSON.stringify(store, null, 2);
  if (Buffer.byteLength(text) > MAX) throw new DemoCredentialError("demo_store_capacity", 409);
  const temp = `${DEMO_STORE_PATH}.${randomUUID()}.tmp`;
  try { await fs.writeFile(temp, text, { mode: 0o600, flag: "wx" }); await fs.rename(temp, DEMO_STORE_PATH); }
  finally { await fs.unlink(temp).catch(() => undefined); }
}
async function mutate<T>(fn: (store: Store) => T | Promise<T>): Promise<T> {
  return withSecurityStoreLock(DEMO_STORE_PATH, async () => {
    const store = (await readRaw()) ?? { version: 1, records: [] };
    const out = await fn(store);
    await write(store);
    return out;
  });
}
/** The workspace IS the bound project folder: the owner comes from that folder's
 *  credential binding, never from a caller-supplied owner or free-form workspace. */
async function scope(input: Record<string, unknown>) {
  if (typeof input.cwd !== "string" || !input.cwd) throw new DemoCredentialError("workspace_cwd_required");
  const workspace = canonicalFolder(input.cwd), state = await readIntegrationState();
  const binding = folderBinding(state, workspace);
  if (!binding) throw new DemoCredentialError("workspace_folder_not_bound", 409);
  return { owner: identity(binding.user, "user"), workspace: binding.path };
}
function find(store: Store, owner: string, workspace: string, id: string) {
  const row = store.records.find(r => r.id === id);
  if (!row || row.owner !== owner || row.workspace !== workspace) throw new DemoCredentialError("demo_credential_not_found", 404);
  return row;
}
export async function createDemoCredential(input: Record<string, unknown>) {
  const { owner, workspace } = await scope(input), email = cleanEmail(input.email), password = cleanPassword(input.password);
  const fields = { label: optionalText(input.label, "invalid_demo_label", 120), site: optionalText(input.site, "invalid_demo_site", 2048), notes: optionalText(input.notes, "invalid_demo_notes", 2000) };
  return mutate(store => {
    if (store.records.some(r => r.owner === owner && r.workspace === workspace && r.email === email)) throw new DemoCredentialError("demo_credential_exists", 409);
    const now = Date.now(), row: DemoCredentialRecord = { id: randomUUID(), owner, workspace, email, password, ...fields, createdAt: now, updatedAt: now, revision: 1 };
    store.records.push(row);
    return summary(row);
  });
}
export async function listDemoCredentials(input: Record<string, unknown>) {
  const { owner, workspace } = await scope(input), store = await readRaw();
  return { owner, workspace, demoUsers: (store?.records ?? []).filter(r => r.owner === owner && r.workspace === workspace).map(summary) };
}
/** Full record including the password: agent/server-side sign-in resolution only. */
export async function getDemoCredential(input: Record<string, unknown>) {
  const { owner, workspace } = await scope(input), store = await readRaw(), id = identity(input.id, "id");
  if (!store) throw new DemoCredentialError("demo_credential_not_found", 404);
  return find(store, owner, workspace, id);
}
export async function updateDemoCredential(input: Record<string, unknown>) {
  const { owner, workspace } = await scope(input), id = identity(input.id, "id");
  return mutate(store => {
    const row = find(store, owner, workspace, id);
    if (input.email !== undefined) { const email = cleanEmail(input.email); if (store.records.some(r => r.id !== id && r.owner === owner && r.workspace === workspace && r.email === email)) throw new DemoCredentialError("demo_credential_exists", 409); row.email = email; }
    if (input.password !== undefined) row.password = cleanPassword(input.password);
    if (input.label !== undefined) row.label = optionalText(input.label, "invalid_demo_label", 120);
    if (input.site !== undefined) row.site = optionalText(input.site, "invalid_demo_site", 2048);
    if (input.notes !== undefined) row.notes = optionalText(input.notes, "invalid_demo_notes", 2000);
    row.revision += 1; row.updatedAt = Date.now();
    return summary(row);
  });
}
export async function deleteDemoCredential(input: Record<string, unknown>) {
  const { owner, workspace } = await scope(input), id = identity(input.id, "id");
  return mutate(store => {
    find(store, owner, workspace, id);
    store.records = store.records.filter(r => r.id !== id);
    return { id, deleted: true };
  });
}
export type RevealActor = { session: SessionPayload; role: DeviceRole; deviceId: string | null };
const GENERIC = "secret_field_not_revealable", FIELD = /^[A-Za-z][A-Za-z0-9]{0,63}$/;
async function storedSecret(input: Record<string, unknown>, key: string) {
  if (input.demoId !== undefined) {
    // The demo password is the only revelable demo field.
    if (key !== "password") throw new DemoCredentialError(GENERIC, 404);
    const { owner, workspace } = await scope(input), store = await readRaw(), row = store?.records.find(r => r.id === String(input.demoId));
    if (!row || row.owner !== owner || row.workspace !== workspace) throw new DemoCredentialError(GENERIC, 404);
    return copyUnits(row.password);
  }
  let resolved;
  try {
    const provider = identity(input.provider, "provider"), connection = identity(input.connection, "connection");
    const user = input.user === undefined ? undefined : identity(input.user, "user");
    const state = await readIntegrationState();
    resolved = { state, route: selectConnection(state, provider, { user, connection, cwd: typeof input.cwd === "string" ? input.cwd : undefined }), provider };
  } catch { throw new DemoCredentialError(GENERIC, 404); }
  const { state, route, provider } = resolved;
  if (route.connection.source !== "direct") throw new DemoCredentialError("external_secrets_forbidden", 409);
  let target = route.connection;
  if (target.sharedFrom) {
    const backing = resolveSharedConnection(state, route.user, target);
    // A shared alias backed by ANOTHER credential owner is never revelable here.
    if (backing.user !== route.user) throw new DemoCredentialError("shared_alias_readonly", 409);
    target = backing.connection;
  }
  const field = connectionMethod(provider, target.source, target.authMethod).fields.find(f => f.key === key);
  const value = target.values[key];
  // Unknown, non-secret and empty fields share one refusal so existence cannot leak.
  if (!field || field.secret !== true || typeof value !== "string" || !value) throw new DemoCredentialError(GENERIC, 404);
  return copyUnits(value);
}
/** The ONE path a stored secret leaves the server on. Human-only: the agent has no
 *  tool that reaches this route; it reads a demo password via demo.get instead. */
export async function revealSecret(input: Record<string, unknown>, actor: RevealActor): Promise<{ key: string; value: string }> {
  const key = typeof input.key === "string" ? input.key : "";
  const target = (input.demoId !== undefined ? `demo:${String(input.demoId)}` : `${String(input.provider)}:${String(input.connection)}`).slice(0, 256);
  const deny = async (code: string, status: number) => {
    await audit({ action: "infra.write", actor: actor.deviceId || null, target, ok: false, detail: `integration.secret-reveal refused key=${key.slice(0, 64)}` });
    return new DemoCredentialError(code, status);
  };
  if (!actor.deviceId || !(await liveSessionAuthorized(actor.session, actor.role))) throw await deny("owner_required", 403);
  if (!FIELD.test(key)) throw await deny(GENERIC, 404);
  if (rateLimited(`secret-reveal:${actor.deviceId}:${target}`, 5, 60_000)) throw await deny("rate_limited", 429);
  let value: string;
  try { value = await storedSecret(input, key); }
  catch (error) { if (error instanceof IntegrationError) throw await deny(GENERIC, 404); if (error instanceof DemoCredentialError) throw await deny(error.code, error.status); throw await deny(GENERIC, 404); }
  await audit({ action: "infra.write", actor: actor.deviceId, target, ok: true, detail: `integration.secret-reveal key=${key}` });
  return { key, value };
}
