// Stable per-browser 128-bit hex device id, mirroring frontend/slices/auth/lib/device.ts.
// Mirrored into localStorage and a client cookie so a cache-only clear preserves identity.

const STORAGE_KEY = "mso.device.id";
const COOKIE_NAME = "mso-device";
const DEVICE_ID_RE = /^[a-f0-9]{16,128}$/i;
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 2;

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function writeCookie(name: string, value: string): void {
  if (typeof document === "undefined") return;
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${MAX_AGE_SECONDS}; Path=/; SameSite=Strict${secure}`;
}

export function getOrCreateDeviceId(): string {
  if (typeof window === "undefined") return "";
  let id: string | null = null;
  try {
    id = localStorage.getItem(STORAGE_KEY);
  } catch {
    id = null;
  }
  if (!id || !DEVICE_ID_RE.test(id)) {
    const fromCookie = readCookie(COOKIE_NAME);
    if (fromCookie && DEVICE_ID_RE.test(fromCookie)) id = fromCookie;
  }
  if (!id || !DEVICE_ID_RE.test(id)) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    id = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Private browsing or storage quota; cookie still preserves identity.
  }
  writeCookie(COOKIE_NAME, id);
  return id;
}

export function detectDeviceLabel(userAgent = typeof navigator !== "undefined" ? navigator.userAgent : ""): string {
  if (!userAgent) return "Unknown device";
  const os = /Android/.test(userAgent)
    ? "Android"
    : /iPhone|iPad/.test(userAgent)
      ? "iOS"
      : /Mac/.test(userAgent)
        ? "macOS"
        : /Windows/.test(userAgent)
          ? "Windows"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "Unknown";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Chrome\//.test(userAgent)
      ? "Chrome"
      : /Firefox\//.test(userAgent)
        ? "Firefox"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : "Browser";
  return `${browser} · ${os}`;
}
