import type { SurfaceApp, WorkflowEmbed } from "@/lib/contracts/surface-app";
import { appNamespaceHost } from "@/lib/managed-apps/origin";

export const DEFAULT_N8N_SANDBOX = "allow-scripts allow-same-origin allow-forms allow-downloads";

/** Dynamic placeholder derived from NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE,
 *  matching how Hermes/OpenClaw/9Router/Orca derive app hostnames without hardcoding any domain. */
export function suggestedN8nUrl(): string {
  const host = appNamespaceHost("n8n");
  return host ? `https://${host}` : "https://n8n.example.com";
}

const MAX_PATH_LENGTH = 768;
const UNSAFE_PATH_CHARS = /[\\\u0000-\u001f]/;

export type ParsedN8nUrl =
  | { ok: true; origin: string; startPath: string }
  | { ok: false; error: string };

export type ParsedN8nAuthPath =
  | { ok: true; path?: string }
  | { ok: false; error: string };

export type N8nFormDefaults = {
  url: string;
  authPath: string;
  embed: boolean;
};

function hasDotSegment(pathname: string): boolean {
  return pathname.split("/").some((part) => part === "." || part === "..");
}

export function parseN8nSurfaceUrl(raw: string): ParsedN8nUrl {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "Enter the HTTPS address of your n8n instance." };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "Enter a valid HTTPS URL (for example https://n8n.example.com)." };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, error: "n8n must use an HTTPS URL." };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: "Remove credentials from the URL. Sign in inside n8n instead." };
  }
  if (parsed.search || parsed.hash) {
    return { ok: false, error: "Remove query parameters and fragments from the n8n URL." };
  }
  const startPath = parsed.pathname || "/";
  const rawAfterScheme = trimmed.slice(trimmed.indexOf("://") + 3);
  const rawPathIndex = rawAfterScheme.indexOf("/");
  const rawPath = rawPathIndex >= 0 ? rawAfterScheme.slice(rawPathIndex) : "/";
  if (
    !startPath.startsWith("/") ||
    startPath.startsWith("//") ||
    startPath.length > MAX_PATH_LENGTH ||
    UNSAFE_PATH_CHARS.test(startPath) ||
    hasDotSegment(rawPath) ||
    hasDotSegment(startPath)
  ) {
    return { ok: false, error: "The n8n start path is invalid." };
  }
  return { ok: true, origin: parsed.origin, startPath };
}

export function parseN8nAuthPath(raw: string): ParsedN8nAuthPath {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true };
  if (
    !trimmed.startsWith("/") ||
    trimmed.startsWith("//") ||
    trimmed.length > MAX_PATH_LENGTH ||
    UNSAFE_PATH_CHARS.test(trimmed) ||
    hasDotSegment(trimmed)
  ) {
    return { ok: false, error: "Sign-in path must start with / (for example /signin)." };
  }
  if (trimmed.includes("?") || trimmed.includes("#")) {
    return { ok: false, error: "Sign-in path must not contain query parameters or fragments." };
  }
  try {
    const check = new URL(trimmed, "https://surface.invalid");
    if (check.origin !== "https://surface.invalid" || hasDotSegment(check.pathname)) {
      return { ok: false, error: "Sign-in path is invalid." };
    }
    return { ok: true, path: check.pathname };
  } catch {
    return { ok: false, error: "Sign-in path is invalid." };
  }
}

export function extractN8nFormDefaults(app: WorkflowEmbed | null): N8nFormDefaults {
  if (!app) return { url: "", authPath: "", embed: true };
  let authPath = "";
  if (app.loginUrl) {
    try {
      authPath = new URL(app.loginUrl).pathname;
    } catch {
      authPath = "";
    }
  }
  return {
    url: app.url ?? app.origin ?? "",
    authPath,
    embed: app.renderer === "iframe",
  };
}

export function buildN8nSurfaceApp(input: {
  url: string;
  authPath?: string;
  embed: boolean;
  existing?: WorkflowEmbed | null;
}): { ok: true; app: SurfaceApp } | { ok: false; error: string } {
  const parsedUrl = parseN8nSurfaceUrl(input.url);
  if (!parsedUrl.ok) return parsedUrl;
  const parsedAuth = parseN8nAuthPath(input.authPath ?? "");
  if (!parsedAuth.ok) return parsedAuth;
  return {
    ok: true,
    app: {
      id: "n8n",
      title: "n8n",
      description: input.existing?.description || "n8n automation editor",
      origin: parsedUrl.origin,
      startPath: parsedUrl.startPath,
      renderer: input.embed ? "iframe" : "remote",
      presentation: "inline",
      environment: "production",
      placements: ["n8n"],
      sandbox: input.existing?.sandbox ?? DEFAULT_N8N_SANDBOX,
      ...(parsedAuth.path ? { externalAuthPath: parsedAuth.path } : {}),
    },
  };
}

export function formatN8nSurfaceError(code: string | undefined, status?: number): string {
  if (code === "owner_required" || status === 403) {
    return "Owner access is required to configure the n8n connection.";
  }
  if (code === "surface_registry_changed_reload" || status === 409) {
    return "Connection settings changed in another session. Refresh and try again.";
  }
  if (code === "surface_registry_managed_by_environment") {
    return "This n8n connection is managed by deployment configuration and cannot be edited here.";
  }
  if (code === "surface_owned_by_shell") {
    return "An app with id n8n is already configured as a shell app in App Store.";
  }
  if (code === "workflow_login_path_must_not_contain_query") {
    return "Sign-in path must not contain query parameters.";
  }
  if (code === "invalid_surface_metadata") {
    return "Enter a valid HTTPS n8n URL without credentials or query parameters.";
  }
  if (code === "rate_limited" || status === 429) {
    return "Too many updates. Wait a moment and try again.";
  }
  return "Could not save the n8n connection.";
}
