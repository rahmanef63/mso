// Display identity for the single owner account. This is not a login secret,
// a second user directory, or a password store. The login password remains
// OS_LOGIN_PASSWORD.

export const ACCOUNT_PRESETS = ["user", "spark", "shield", "star", "heart", "zap", "leaf", "compass"] as const;
export type AccountPreset = (typeof ACCOUNT_PRESETS)[number];

export type AccountIcon =
  | { type: "preset"; id: AccountPreset }
  | { type: "image"; src: string };

export type AccountProfile = {
  name: string;
  icon: AccountIcon;
};

export const DEFAULT_ACCOUNT_PROFILE: AccountProfile = {
  name: "Owner",
  icon: { type: "preset", id: "user" },
};

export function cleanAccountName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (/[\u0000-\u001F\u007F]/.test(value)) return null;
  const name = value.trim().replace(/ {2,}/g, " ");
  if (name.length < 1 || name.length > 40) return null;
  return name;
}

export function presetIcon(value: unknown): AccountIcon | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.type !== "preset" || typeof row.id !== "string") return null;
  if (!(ACCOUNT_PRESETS as readonly string[]).includes(row.id)) return null;
  return { type: "preset", id: row.id as AccountPreset };
}
