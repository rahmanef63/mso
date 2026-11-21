// Narrow transport/runtime seam shared between Web/PWA and the Rust/Tauri desktop shell.
// Default web and loopback Rust-host runs stay strictly same-origin with relative `/api/*` paths.

export type ShellSurface = "web" | "rust-host" | "tauri-desktop";

export type ShellBridge = {
  surface: ShellSurface;
  apiBaseOrigin: string | null;
};

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]", "::1", "localhost"]);
const SURFACES = new Set<ShellSurface>(["web", "rust-host", "tauri-desktop"]);

export function parseHostOrigin(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  const isLoopback = LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase());
  const protocolOk = parsed.protocol === "https:" || (parsed.protocol === "http:" && isLoopback);
  if (!protocolOk || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    return null;
  }
  return parsed.origin;
}

export function detectShellBridge(scope: unknown = globalThis): ShellBridge {
  if (scope === null || typeof scope !== "object") {
    return { surface: "web", apiBaseOrigin: null };
  }
  const host = scope as Record<string, unknown>;
  const injected = host.__MSO_SHELL__;
  if (injected !== null && typeof injected === "object" && !Array.isArray(injected)) {
    const record = injected as Record<string, unknown>;
    const surface = SURFACES.has(record.surface as ShellSurface)
      ? (record.surface as ShellSurface)
      : "web";
    const apiBaseOrigin = parseHostOrigin(record.apiBaseOrigin);
    if (record.apiBaseOrigin != null && apiBaseOrigin === null) {
      return { surface: "web", apiBaseOrigin: null };
    }
    return { surface, apiBaseOrigin };
  }
  if ("__TAURI_INTERNALS__" in host && host.__TAURI_INTERNALS__ != null) {
    return { surface: "tauri-desktop", apiBaseOrigin: null };
  }
  return { surface: "web", apiBaseOrigin: null };
}

export function resolveApiUrl(path: string, bridge: ShellBridge = detectShellBridge()): string {
  if (!path.startsWith("/api/") || path.includes("://") || path.startsWith("//")) {
    throw new Error("MSO API path must be a root-relative /api/* path");
  }
  return bridge.apiBaseOrigin ? `${bridge.apiBaseOrigin}${path}` : path;
}
