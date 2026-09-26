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

function copyCodeUnits(value: string): string {
  let name = "";
  for (let i = 0; i < value.length; i++) name += String.fromCharCode(value.charCodeAt(i));
  return name;
}

export function cleanAccountName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // Inverted class: C0 and DEL fail the test. The kept string is then copied
  // code unit by code unit so the stored name is not the request string.
  if (/[^\u0020-\u007E\u0080-\uFFFF]/.test(value)) return null;
  const name = copyCodeUnits(value.trim().replace(/ {2,}/g, " "));
  if (name.length < 1 || name.length > 40) return null;
  return name;
}

function canonicalPreset(id: string): AccountPreset | null {
  switch (id) {
    case "user": return "user";
    case "spark": return "spark";
    case "shield": return "shield";
    case "star": return "star";
    case "heart": return "heart";
    case "zap": return "zap";
    case "leaf": return "leaf";
    case "compass": return "compass";
    default: return null;
  }
}

export function presetIcon(value: unknown): AccountIcon | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.type !== "preset" || typeof row.id !== "string") return null;
  const id = canonicalPreset(row.id);
  return id ? { type: "preset", id } : null;
}
