import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { withSecurityStoreLock } from "@/lib/security-store-lock";

// Server-side device allowlist, ported from the VPS Control Room. The login
// password is a weak/memorable factor; the strong factor is a 128-bit device
// id that must be pre-approved here. A new device with the right password is
// NOT let in — it lands in `pending` until an approved device (or the CLI)
// promotes it. This is the "something you have" leg.

export interface ApprovedDevice {
  label: string;
  approvedAt: number;
  lastSeen?: number;
}

export interface PendingDevice {
  label: string;
  firstSeen: number;
  lastSeen: number;
  ip: string;
  attempts: number;
}

interface DeviceStore {
  approved: Record<string, ApprovedDevice>;
  pending: Record<string, PendingDevice>;
}

const MAX_PENDING = 50;

// mso runs as a host process (the deploy user's systemd service) → write our
// own file, no agent round-trip. Override with OS_DEVICE_STORE.
const STORE_PATH =
  process.env.OS_DEVICE_STORE ?? path.join(os.homedir(), ".mso", "auth-devices.json");

// Device ids are client-generated 128-bit+ hex/uuid.
const DEVICE_ID_RE = /^[a-f0-9-]{16,128}$/i;

export function isValidDeviceId(id: unknown): id is string {
  return typeof id === "string" && DEVICE_ID_RE.test(id);
}

// "No file yet" is the ONLY failure that may look like an empty store. Anything else
// — corrupt JSON, EACCES, EIO — must throw.
//
// This used to `catch { return {…empty} }` for every error, and that was a silent way
// to lose every approved device: read() feeds a read-modify-write, and two callers
// (recordPending, approveDevice) write unconditionally. So one unparseable byte in
// auth-devices.json meant the next login from an unapproved device read "no devices",
// then PERSISTED that — wiping the allowlist and locking the owner out of their own
// host. recordPending is reachable from the internet by anyone holding the password.
// Failing loudly here costs a 500 on login; failing quietly cost the allowlist.
async function read(): Promise<DeviceStore> {
  let raw: string;
  try {
    raw = await fs.readFile(STORE_PATH, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { approved: {}, pending: {} };
    throw e;
  }
  const parsed = JSON.parse(raw) as Partial<DeviceStore>;
  return { approved: parsed.approved ?? {}, pending: parsed.pending ?? {} };
}

async function write(store: DeviceStore): Promise<void> {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true, mode: 0o700 });
  const tmp = `${STORE_PATH}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
  await fs.rename(tmp, STORE_PATH);
}

// Approval/revocation is a security decision, so serialize the entire read-modify-
// write transaction. A plain atomic rename is not enough: two requests can read the
// same approved set and a later `touchApproved` can otherwise overwrite a revoke.
let mutationChain: Promise<unknown> = Promise.resolve();
function mutate<T>(fn: () => Promise<T>): Promise<T> {
  const locked = () => withSecurityStoreLock(STORE_PATH, fn);
  const run = mutationChain.then(locked, locked);
  mutationChain = run.then(() => undefined, () => undefined);
  return run;
}

export async function isApproved(deviceId: string): Promise<boolean> {
  const store = await read();
  return deviceId in store.approved;
}

/** Mark an approved device as just-seen (best effort). */
export function touchApproved(deviceId: string): Promise<void> {
  return mutate(async () => {
    const store = await read();
    const entry = store.approved[deviceId];
    if (!entry) return;
    entry.lastSeen = Date.now();
    delete store.pending[deviceId];
    await write(store);
  });
}

export async function listDevices(): Promise<DeviceStore> {
  return read();
}

/** Approve a device (moves it out of pending). Used by the in-app panel + CLI. */
export function approveDevice(deviceId: string, label?: string): Promise<void> {
  return mutate(async () => {
    const store = await read();
    const pending = store.pending[deviceId];
    store.approved[deviceId] = {
      label: (label && label.slice(0, 80)) || pending?.label || "approved device",
      approvedAt: Date.now(),
    };
    delete store.pending[deviceId];
    await write(store);
  });
}

/** Un-trust a device (and clear any pending record for the same id). */
export function revokeDevice(deviceId: string): Promise<void> {
  return mutate(async () => {
    const store = await read();
    if (!(deviceId in store.approved) && !(deviceId in store.pending)) return;
    delete store.approved[deviceId];
    delete store.pending[deviceId];
    await write(store);
  });
}

/** Record (or bump) a device that presented the right password but isn't approved. */
export function recordPending(deviceId: string, label: string, ip: string): Promise<void> {
  return mutate(async () => {
    const store = await read();
    const now = Date.now();
    const existing = store.pending[deviceId];
    if (existing) {
      existing.lastSeen = now;
      existing.attempts += 1;
      existing.label = label || existing.label;
      existing.ip = ip;
    } else {
      store.pending[deviceId] = { label, firstSeen: now, lastSeen: now, ip, attempts: 1 };
    }
    const ids = Object.keys(store.pending);
    if (ids.length > MAX_PENDING) {
      ids
        .sort((a, b) => store.pending[a].lastSeen - store.pending[b].lastSeen)
        .slice(0, ids.length - MAX_PENDING)
        .forEach((id) => delete store.pending[id]);
    }
    await write(store);
  });
}
