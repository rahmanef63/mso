import { ApiError } from "../host-api.ts";
import { detectShellBridge, resolveApiUrl, type ShellBridge } from "../shell-bridge.ts";

export { ApiError };
export type { ShellBridge };

export const ACCOUNT_PRESETS = ["user", "spark", "shield", "star", "heart", "zap", "leaf", "compass"] as const;
export type AccountPreset = (typeof ACCOUNT_PRESETS)[number];
export type AccountIcon = { type: "preset"; id: AccountPreset } | { type: "library"; value: string } | { type: "image"; src: string };
export type AccountProfile = { name: string; icon: AccountIcon };
export type AccountProfilePatch = { name?: string; icon?: AccountIcon };
export type PasswordChangeInput = { currentPassword: string; newPassword: string; confirmPassword?: string };
export type AccountReadyState = {
  kind: "ready"; profile: AccountProfile; savingProfile: boolean; rotatingPassword: boolean;
  passwordRotated: boolean; notice: string | null; actionError: string | null;
};
export type AccountState = { kind: "loading" } | AccountReadyState | { kind: "error"; message: string };

export const MIN_PASSWORD_LENGTH = 6;
export const MAX_PASSWORD_LENGTH = 128;
export const MAX_ACCOUNT_NAME_LENGTH = 40;

const PRESETS = new Set<AccountPreset>(ACCOUNT_PRESETS);
const SAFE_PASSWORD = /^[A-Za-z0-9!@%^*_+\-=.,:?~]{6,128}$/;
const LIBRARY_ICON = /^(emoji:[^\s]{1,8}|lucide:[A-Za-z0-9]+|phosphor:[A-Za-z0-9]+)(\?c=[0-9a-fA-F]{6})?$/;
const IMAGE_DATA_URL = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
const CTRL_CHAR = /[^\u0020-\u007E\u0080-\uFFFF]/;

const SESSION_ERR = "Your session is unavailable or this device no longer has access.";
const API_UNAVAILABLE = "MSO API is unavailable. Configure the local backend before retrying.";
const INVALID_PROFILE = "The MSO account profile response is invalid.";
const INVALID_PW_RES = "The MSO password update response is invalid.";
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

export function normalizeAccountName(raw: unknown): string | null {
  if (typeof raw !== "string" || CTRL_CHAR.test(raw)) return null;
  const clean = raw.trim().replace(/ {2,}/g, " ");
  return clean.length >= 1 && clean.length <= MAX_ACCOUNT_NAME_LENGTH ? clean : null;
}

export function validateNewPassword(password: string): string | null {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > MAX_PASSWORD_LENGTH) return `Password must be ${MAX_PASSWORD_LENGTH} characters or fewer.`;
  if (!SAFE_PASSWORD.test(password)) return "Use letters, numbers, or basic symbols (!@%^*_+-=.,:?~). Spaces, quotes, and $ are not allowed.";
  return null;
}

function validateIcon(value: unknown): AccountIcon | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  if (value.type === "preset" && typeof value.id === "string" && PRESETS.has(value.id as AccountPreset)) return { type: "preset", id: value.id as AccountPreset };
  if (value.type === "library" && typeof value.value === "string" && value.value.length <= 96 && LIBRARY_ICON.test(value.value)) return { type: "library", value: value.value };
  if (value.type === "image" && typeof value.src === "string" && value.src.length <= 48_000 && IMAGE_DATA_URL.test(value.src)) return { type: "image", src: value.src };
  return null;
}

function validateProfile(value: unknown): AccountProfile {
  if (!isRecord(value)) throw new ApiError(INVALID_PROFILE, 502);
  const name = normalizeAccountName(value.name);
  const icon = validateIcon(value.icon);
  if (!name || !icon) throw new ApiError(INVALID_PROFILE, 502);
  return { name, icon };
}

function mapAccountError(status: number, code: string, kind: "read" | "write"): string {
  if (status === 401) return SESSION_ERR;
  if (status === 403) {
    if (code === "demo") return kind === "write" ? "Account updates are unavailable in demo mode." : "Account profile is unavailable in demo mode.";
    return kind === "write" ? "Owner role is required to update the account profile." : SESSION_ERR;
  }
  if (status === 429) return "Too many requests. Wait a moment and retry.";
  if (status === 400) return kind === "write" ? "Account update was rejected. Check the display name and retry." : "Account request was rejected.";
  return kind === "write" ? `Account update failed (${status}).` : `Account profile request failed (${status}).`;
}

const PW_400: Record<string, string> = {
  mismatch: "New password and confirmation do not match.",
  weak_password: "Use 6 to 128 letters, numbers, or basic symbols. Spaces, quotes, and $ are not allowed.",
  unchanged: "Choose a new password different from the current one.",
};
const PW_409: Record<string, string> = {
  password_source_mismatch: "The login password is not stored in .env.local, so the cockpit cannot rotate it.",
  password_file_unsafe: "The host password file cannot be updated safely.",
};

function mapPasswordError(status: number, code: string): string {
  if (status === 401) return code === "bad_current" ? "Current password is incorrect." : SESSION_ERR;
  if (status === 403) return code === "demo" ? "Password rotation is unavailable in demo mode." : "Owner role is required to rotate the cockpit password.";
  if (status === 429) return "Too many password attempts. Wait a minute before retrying.";
  if (status === 400) return PW_400[code] ?? "Password update was rejected. Check the fields and retry.";
  if (status === 409) return PW_409[code] ?? "Password rotation is unavailable for this host configuration.";
  return `Password update failed (${status}).`;
}

async function requestAuthJson(
  method: "GET" | "POST", path: string, signal: AbortSignal, fetcher: typeof fetch, bridge: ShellBridge,
  mapErr: (status: number, code: string) => string, invalidMsg: string, payload?: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetcher(resolveApiUrl(path, bridge), {
    method, credentials: bridge.apiBaseOrigin ? "include" : "same-origin", cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    headers: { Accept: "application/json", ...(payload ? { "Content-Type": "application/json" } : {}) },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
  const isJson = res.headers.get("content-type")?.includes("application/json") ?? false;
  if (!res.ok) {
    const errBody = isJson ? await res.json().catch(() => null) : null;
    const code = isRecord(errBody) && typeof errBody.error === "string" ? errBody.error : "";
    throw new ApiError(mapErr(res.status, code), res.status);
  }
  if (!isJson) throw new ApiError(API_UNAVAILABLE, 502);
  try { return await res.json(); } catch { throw new ApiError(invalidMsg, 502); }
}

export const readAccountProfile = async (
  signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<AccountProfile> =>
  validateProfile(await requestAuthJson("GET", "/api/auth/account", signal, fetcher, bridge, (s, c) => mapAccountError(s, c, "read"), INVALID_PROFILE));

export async function updateAccountProfile(
  patch: AccountProfilePatch, signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<AccountProfile> {
  const body: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const clean = normalizeAccountName(patch.name);
    if (!clean) throw new ApiError("Enter a display name between 1 and 40 characters.", 400);
    body.name = clean;
  }
  if (patch.icon !== undefined) {
    const icon = validateIcon(patch.icon);
    if (!icon) throw new ApiError("Selected account icon is invalid.", 400);
    body.icon = icon;
  }
  if (body.name === undefined && body.icon === undefined) throw new ApiError("Nothing to update.", 400);
  const data = await requestAuthJson("POST", "/api/auth/account", signal, fetcher, bridge, (s, c) => mapAccountError(s, c, "write"), INVALID_PROFILE, body);
  return validateProfile(data);
}

export async function changeCockpitPassword(
  input: PasswordChangeInput, signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<void> {
  if (typeof input.currentPassword !== "string" || input.currentPassword.length === 0) throw new ApiError("Enter your current cockpit password.", 400);
  const policyErr = validateNewPassword(input.newPassword);
  if (policyErr) throw new ApiError(policyErr, 400);
  const confirmPassword = input.confirmPassword ?? input.newPassword;
  if (confirmPassword !== input.newPassword) throw new ApiError(PW_400.mismatch, 400);
  if (input.currentPassword === input.newPassword) throw new ApiError(PW_400.unchanged, 400);
  const data = await requestAuthJson("POST", "/api/auth/password", signal, fetcher, bridge, mapPasswordError, INVALID_PW_RES, {
    currentPassword: input.currentPassword, newPassword: input.newPassword, confirmPassword,
  });
  if (!isRecord(data) || data.ok !== true) throw new ApiError(INVALID_PW_RES, 502);
}

export function createAccountController(update: (state: AccountState) => void, fetcher = fetch, bridge?: ShellBridge) {
  let gen = 0, active: AbortController | undefined, disposed = false, current: AccountProfile | null = null, rotated = false;
  const emitReady = (extra: Partial<AccountReadyState> = {}) => {
    if (!current) return;
    update({ kind: "ready", profile: current, savingProfile: false, rotatingPassword: false, passwordRotated: rotated, notice: null, actionError: null, ...extra });
  };
  const nextCtrl = () => { const run = ++gen; active?.abort(); const ctrl = (active = new AbortController()); return { run, ctrl }; };
  async function runMutation(busy: Partial<AccountReadyState>, fallbackErr: string, fn: (signal: AbortSignal) => Promise<string>): Promise<boolean> {
    if (disposed || !current) return false;
    const { run, ctrl } = nextCtrl();
    emitReady(busy);
    try {
      const notice = await fn(ctrl.signal);
      if (disposed || run !== gen) return false;
      emitReady({ notice }); return true;
    } catch (e) {
      if (disposed || run !== gen || ctrl.signal.aborted) return false;
      emitReady({ actionError: e instanceof ApiError ? e.message : fallbackErr }); return false;
    }
  }
  return {
    async refresh() {
      if (disposed) return;
      const { run, ctrl } = nextCtrl();
      update({ kind: "loading" });
      try {
        const profile = await readAccountProfile(ctrl.signal, fetcher, bridge);
        if (disposed || run !== gen) return;
        current = profile; emitReady();
      } catch (e) {
        if (disposed || run !== gen || ctrl.signal.aborted) return;
        update({ kind: "error", message: e instanceof ApiError ? e.message : "Could not load account profile. Check the backend and retry." });
      }
    },
    saveDisplayName: (name: string) => runMutation({ savingProfile: true }, "Could not update account display name. Retry when reachable.", async (sig) => {
      current = await updateAccountProfile({ name }, sig, fetcher, bridge);
      return "Account display name updated.";
    }),
    rotatePassword: (input: PasswordChangeInput) => runMutation({ rotatingPassword: true }, "Could not update cockpit password. Retry when reachable.", async (sig) => {
      await changeCockpitPassword(input, sig, fetcher, bridge);
      rotated = true;
      return "Cockpit password updated. Use the new password next time you sign in.";
    }),
    dispose() { disposed = true; gen++; active?.abort(); },
  };
}
