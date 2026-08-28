import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { withSecurityStoreLock } from "@/lib/security-store-lock";
import {
  DeviceRoleError,
  isDeviceRole,
  storedDeviceRole,
  type DeviceRole,
} from "./roles";

// Server-side device allowlist, ported from the VPS Control Room. The login
// password is a weak/memorable factor; the strong factor is a 128-bit device
// id that must be pre-approved here. A new device with the right password is
// NOT let in — it lands in `pending` until an approved device (or the CLI)
// promotes it. A role then constrains the approved browser at every API call.

export interface ApprovedDevice {
  label: string;
  approvedAt: number;
  lastSeen?: number;
  role: DeviceRole;
}

export interface PendingDevice {
  label: string;
  firstSeen: number;
  lastSeen: number;
  ip: string;
  attempts: number;
}

export interface DeviceStore {
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

function finiteTime(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeApproved(raw: unknown): Record<string, ApprovedDevice> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, ApprovedDevice> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!isValidDeviceId(id) || !value || typeof value !== "object" || Array.isArray(value)) continue;
    const row = value as Record<string, unknown>;
    out[id] = {
      label: typeof row.label === "string" && row.label ? row.label.slice(0, 80) : "approved device",
      approvedAt: finiteTime(row.approvedAt, 0),
      ...(typeof row.lastSeen === "number" && Number.isFinite(row.lastSeen) ? { lastSeen: row.lastSeen } : {}),
      // Stores written before delegated roles had no role field. Preserve their
      // historical full access, while malformed future values fail down to viewer.
      role: storedDeviceRole(row.role),
    };
  }
  return out;
}

function normalizePending(raw: unknown): Record<string, PendingDevice> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, PendingDevice> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!isValidDeviceId(id) || !value || typeof value !== "object" || Array.isArray(value)) continue;
    const row = value as Record<string, unknown>;
    out[id] = {
      label: typeof row.label === "string" && row.label ? row.label.slice(0, 80) : "unknown device",
      firstSeen: finiteTime(row.firstSeen, Date.now()),
      lastSeen: finiteTime(row.lastSeen, Date.now()),
      ip: typeof row.ip === "string" ? row.ip.slice(0, 120) : "unknown",
      attempts: Math.max(1, Math.floor(finiteTime(row.attempts, 1))),
    };
  }
  return out;
}

// "No file yet" is the ONLY failure that may look like an empty store. Anything else
// — corrupt JSON, EACCES, EIO — must throw. A normalized read also migrates legacy
// role-less entries in memory; the next legitimate mutation persists the role field.
async function read(): Promise<DeviceStore> {
  let raw: string;
  try {
    raw = await fs.readFile(STORE_PATH, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { approved: {}, pending: {} };
    throw e;
  }
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  return {
    approved: normalizeApproved(parsed.approved),
    pending: normalizePending(parsed.pending),
  };
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

function ownerCount(store: DeviceStore): number {
  return Object.values(store.approved).filter((entry) => entry.role === "owner").length;
}

export async function getApprovedDevice(deviceId: string): Promise<ApprovedDevice | null> {
  const store = await read();
  return store.approved[deviceId] ?? null;
}

export async function isApproved(deviceId: string): Promise<boolean> {
  return (await getApprovedDevice(deviceId)) !== null;
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

/** Approve a device (moves it out of pending). Omitted role preserves legacy owner semantics. */
export function approveDevice(deviceId: string, label?: string, role: DeviceRole = "owner"): Promise<void> {
  if (!isDeviceRole(role)) return Promise.reject(new DeviceRoleError("invalid device role"));
  return mutate(async () => {
    const store = await read();
    if (store.approved[deviceId]) throw new DeviceRoleError("device is already approved; use set_role");
    const pending = store.pending[deviceId];
    store.approved[deviceId] = {
      label: (label && label.slice(0, 80)) || pending?.label || "approved device",
      approvedAt: Date.now(),
      role,
    };
    delete store.pending[deviceId];
    await write(store);
  });
}

/** Change an approved device's live role. Demotion takes effect on its next request. */
export function setDeviceRole(deviceId: string, role: DeviceRole): Promise<void> {
  if (!isDeviceRole(role)) return Promise.reject(new DeviceRoleError("invalid device role"));
  return mutate(async () => {
    const store = await read();
    const entry = store.approved[deviceId];
    if (!entry) throw new DeviceRoleError("device is not approved");
    if (entry.role === "owner" && role !== "owner" && ownerCount(store) <= 1) {
      throw new DeviceRoleError("at least one owner device must remain approved");
    }
    entry.role = role;
    await write(store);
  });
}

/** Un-trust a device (and clear any pending record for the same id). */
export function revokeDevice(deviceId: string): Promise<void> {
  return mutate(async () => {
    const store = await read();
    const approved = store.approved[deviceId];
    if (!approved && !(deviceId in store.pending)) return;
    if (approved?.role === "owner" && ownerCount(store) <= 1) {
      throw new DeviceRoleError("at least one owner device must remain approved");
    }
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
