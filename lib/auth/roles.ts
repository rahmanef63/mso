/**
 * Device-scoped access levels for the owner-first cockpit.
 *
 * These are not Linux users, an identity directory, or SSO. They constrain what an
 * already-approved browser device may ask the MSO web/API layer to do. The process
 * still runs as one Unix account, so an owner session remains equivalent to that
 * account and an operator must still be treated as trusted with operational data.
 */
export const DEVICE_ROLES = ["viewer", "operator", "owner"] as const;
export type DeviceRole = (typeof DEVICE_ROLES)[number];

const ROLE_RANK: Record<DeviceRole, number> = {
  viewer: 0,
  operator: 1,
  owner: 2,
};

export function isDeviceRole(value: unknown): value is DeviceRole {
  return typeof value === "string" && (DEVICE_ROLES as readonly string[]).includes(value);
}

/** Missing means a legacy pre-role owner device. An invalid stored value fails down. */
export function storedDeviceRole(value: unknown): DeviceRole {
  if (value === undefined) return "owner";
  return isDeviceRole(value) ? value : "viewer";
}

export function roleAtLeast(actual: DeviceRole, required: DeviceRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

export function roleLabel(role: DeviceRole): string {
  if (role === "owner") return "Owner";
  if (role === "operator") return "Operator";
  return "Viewer";
}

export class DeviceRoleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeviceRoleError";
  }
}
