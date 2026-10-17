import { constants, promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { expandOwnerStorePath } from "@/lib/owner-store-path.js";
import { pinSecurityStorePath } from "@/lib/security-store-path";
import { withSecurityStoreLock } from "@/lib/security-store-lock";
import type { ManagedDomainConfig, ManagedDomainState } from "@/lib/contracts/managed-domains";
import { validateDomainConfig, validateDomainState } from "./domain-config";

const MAX_BYTES = 64 * 1024;
export const managedDomainStorePath = () => expandOwnerStorePath(process.env.OS_MANAGED_DOMAINS_STORE ?? path.join(os.homedir(), ".mso", "private", "managed-domains.json"));
const empty = (): ManagedDomainState => ({ version: 1, revision: 0, ownerId: randomUUID(), config: null, apps: {} });

async function readFile(file: string): Promise<ManagedDomainState | null> {
  let handle;
  try {
    handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_BYTES || stat.uid !== process.getuid?.() || (stat.mode & 0o077)) throw new Error("unsafe managed-domain state file");
    return validateDomainState(JSON.parse(await handle.readFile("utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  } finally { await handle?.close(); }
}
async function atomicWrite(file: string, state: ManagedDomainState): Promise<void> {
  const text = JSON.stringify(validateDomainState(state), null, 2) + "\n";
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error("managed-domain state capacity exceeded");
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temporary, "wx", 0o600);
    try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temporary, file);
  } finally { await fs.unlink(temporary).catch(() => undefined); }
}
export async function readManagedDomains(): Promise<ManagedDomainState> {
  const pinned = await pinSecurityStorePath(managedDomainStorePath());
  try { return await readFile(pinned.file) ?? empty(); }
  finally { await pinned.directory.close(); }
}
export function withManagedDomainOperation<T>(run: () => Promise<T>): Promise<T> {
  return withSecurityStoreLock(`${managedDomainStorePath()}.operation`, run, { busyTimeoutMs: 5_000 });
}
export function mutateManagedDomains<T>(change: (state: ManagedDomainState) => T): Promise<T> {
  return withSecurityStoreLock(managedDomainStorePath(), async () => {
    const pinned = await pinSecurityStorePath(managedDomainStorePath());
    try {
      const previous = await readFile(pinned.file);
      const state = previous ? structuredClone(previous) : empty();
      const result = change(state);
      state.revision++;
      validateDomainState(state);
      if (previous) await atomicWrite(`${pinned.file}.previous`, previous);
      await atomicWrite(pinned.file, state);
      await pinned.directory.sync();
      return result;
    } finally { await pinned.directory.close(); }
  });
}
export function saveManagedDomainConfig(input: ManagedDomainConfig): Promise<ManagedDomainState> {
  const config = validateDomainConfig(input);
  return withManagedDomainOperation(() => mutateManagedDomains(state => {
    // Rebinding an existing hostname/account is a migration, not a retry.
    if (state.config && Object.entries(config).some(([key, value]) => key !== "autoProvision" && state.config![key as keyof ManagedDomainConfig] !== value)) {
      throw new Error("domain configuration already exists with different routing; preserve and migrate existing routes before replacing it");
    }
    state.config = config;
    return state;
  }));
}
export function restoreManagedDomains(): Promise<ManagedDomainState> {
  return withManagedDomainOperation(() => withSecurityStoreLock(managedDomainStorePath(), async () => {
    const pinned = await pinSecurityStorePath(managedDomainStorePath());
    try {
      const previous = await readFile(`${pinned.file}.previous`);
      if (!previous) throw new Error("no previous managed-domain snapshot exists");
      // Never follow or replace an unexpected object at the state filename.
      const stat = await fs.lstat(pinned.file).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; return null; });
      if (stat && (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o077))) throw new Error("unsafe managed-domain state file");
      previous.revision++;
      await atomicWrite(pinned.file, previous);
      await pinned.directory.sync();
      return previous;
    } finally { await pinned.directory.close(); }
  }));
}
