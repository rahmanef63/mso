import { constants, promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import os from "node:os";
import path from "node:path";
import type { AppDomainRecord } from "@/lib/contracts/app-domain";
import { expandOwnerStorePath } from "@/lib/owner-store-path.js";
import { pinSecurityStorePath } from "@/lib/security-store-path";
import { withSecurityStoreLock } from "@/lib/security-store-lock";

/** Owner-only store beside `managed-domains.json`: 0600 file, 0700 parent, O_NOFOLLOW, uid-checked. */
const MAX_BYTES = 64 * 1024;
const PHASES = new Set(["pending", "dns-ready", "route-ready", "ready", "blocked"]);
const PROVIDERS = new Set(["cloudflare", "hostinger", "dokploy", "custom"]);
const FIELDS = ["appId", "hostname", "phase", "provider", "dnsAction", "routeAction", "error", "localOrigin", "verifiedAt", "updatedAt"];
const DNS_ACTIONS = ["created", "updated", "unchanged"], ROUTE_ACTIONS = ["created", "unchanged"];
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/, LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export type AppDomainState = { version: 1; revision: number; apps: Record<string, AppDomainRecord> };

export const appDomainStorePath = () => expandOwnerStorePath(process.env.OS_SHELL_APP_DOMAINS_STORE
  ?? path.join(os.homedir(), ".mso", "private", "shell-app-domains.json"));
const empty = (): AppDomainState => ({ version: 1, revision: 0, apps: {} });

export function isHostname(value: unknown): value is string {
  return typeof value === "string" && value.length <= 253 && isIP(value) === 0 && value === value.toLowerCase()
    && !value.endsWith(".") && value.includes(".") && value.split(".").every(label => LABEL.test(label));
}
function asRecord(value: unknown): AppDomainRecord {
  const row = (value && typeof value === "object" && !Array.isArray(value) ? value : null) as Record<string, unknown> | null;
  if (!row || Object.keys(row).some(key => !FIELDS.includes(key)) || typeof row.appId !== "string" || !ID.test(row.appId)
    || !isHostname(row.hostname) || !PHASES.has(String(row.phase)) || !Number.isSafeInteger(row.updatedAt)
    || (row.provider !== null && !PROVIDERS.has(String(row.provider)))) throw new Error("invalid shell-app domain state");
  if (row.dnsAction !== undefined && !DNS_ACTIONS.includes(String(row.dnsAction))) throw new Error("invalid shell-app domain DNS action");
  if (row.routeAction !== undefined && !ROUTE_ACTIONS.includes(String(row.routeAction))) throw new Error("invalid shell-app domain route action");
  if (row.error !== undefined && (typeof row.error !== "string" || row.error.length > 512)) throw new Error("invalid shell-app domain diagnostic");
  if (row.localOrigin !== undefined && (typeof row.localOrigin !== "string" || row.localOrigin.length > 253)) throw new Error("invalid shell-app domain loopback origin");
  if (row.verifiedAt !== undefined && !Number.isSafeInteger(row.verifiedAt)) throw new Error("invalid shell-app domain verification timestamp");
  return row as AppDomainRecord;
}
export function parseAppDomainState(value: unknown): AppDomainState {
  const raw = (value && typeof value === "object" && !Array.isArray(value) ? value : null) as Record<string, unknown> | null;
  if (!raw || Object.keys(raw).some(key => !["version", "revision", "apps"].includes(key)) || raw.version !== 1
    || !Number.isSafeInteger(raw.revision) || Number(raw.revision) < 0
    || !raw.apps || typeof raw.apps !== "object" || Array.isArray(raw.apps)) throw new Error("invalid shell-app domain state");
  const apps: Record<string, AppDomainRecord> = {};
  for (const [id, row] of Object.entries(raw.apps as Record<string, unknown>)) {
    const parsed = asRecord(row);
    if (parsed.appId !== id) throw new Error("invalid shell-app domain state");
    apps[id] = parsed;
  }
  return { version: 1, revision: Number(raw.revision), apps };
}
async function writeState(file: string, state: AppDomainState): Promise<void> {
  const text = JSON.stringify(parseAppDomainState(state), null, 2) + "\n";
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error("shell-app domain state capacity exceeded");
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temporary, "wx", 0o600);
    try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temporary, file);
  } finally { await fs.unlink(temporary).catch(() => undefined); }
}
/** Never repairs or replaces an unsafe object at the state filename. */
export async function readAppDomainState(): Promise<AppDomainState> {
  const pinned = await pinSecurityStorePath(appDomainStorePath());
  let handle;
  try {
    handle = await fs.open(pinned.file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_BYTES || stat.uid !== process.getuid?.() || (stat.mode & 0o077)) throw new Error("unsafe shell-app domain state file");
    return parseAppDomainState(JSON.parse(await handle.readFile("utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty();
    throw error;
  } finally { await handle?.close(); await pinned.directory.close(); }
}
export function mutateAppDomainState(change: (state: AppDomainState) => void): Promise<void> {
  return withSecurityStoreLock(appDomainStorePath(), async () => {
    const pinned = await pinSecurityStorePath(appDomainStorePath());
    try {
      const next = structuredClone(await readAppDomainState());
      change(next); next.revision++;
      await writeState(pinned.file, next);
      await pinned.directory.sync();
    } finally { await pinned.directory.close(); }
  });
}
/** Serializes whole provisioning runs so two apps never interleave their phases. */
export const withAppDomainOperation = <T>(run: () => Promise<T>): Promise<T> =>
  withSecurityStoreLock(`${appDomainStorePath()}.operation`, run, { busyTimeoutMs: 5_000 });
