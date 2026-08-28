"use client";

import { useMemo, type ReactNode } from "react";
import { HostApiProvider } from "@/features/appshell";
import { useAppearance } from "@/lib/appearance";
import { useSession } from "@/features/auth";
import { IS_DEMO } from "@/lib/demo";
import { MockAdapter } from "./mock-adapter";
import { HttpAdapter } from "./http-adapter";
import type { OsApi } from "./types";

// Same-origin URL for raw file bytes (image/video/audio/pdf). Demo media lives
// in /demo-media/* as static public assets (served with no host/auth — works in
// the demo). Everything else streams from the host via the cookie-authed raw
// route (works as an <img>/<video>/<audio> src directly, no token plumbing).
export function rawUrl(path: string): string {
  if (path.startsWith("/demo-media/")) return path;
  return "/api/v1/fs/raw?path=" + encodeURIComponent(path);
}

// Same-origin URL for a streamed zip of `names` (basenames) inside `base` (the
// current dir). Cookie-authed via the GET route → a hidden <a download> streams
// it through the browser's download manager. No demo fallback (no host).
export function zipUrl(
  base: string,
  names: string[],
  filename: string,
  exclude: string[] = [],
): string {
  const p = new URLSearchParams({ base, name: filename });
  for (const n of names) p.append("n", n);
  for (const x of exclude) p.append("x", x);
  return "/api/v1/fs/zip?" + p.toString();
}

// mso adapter injection: pick mock (default) ↔ live, then hand the concrete
// api to the framework's HostApiProvider (which owns the context useOsApi reads).
// Live talks to SAME-ORIGIN `/api/v1` route handlers (base url ""); the signed
// session cookie rides along, the routes verify it, then proxy to the host agent
// with the gateway secret (server-side only). Demo never touches the host.
export function OsApiProvider({ children }: { children: ReactNode }) {
  const { tweaks } = useAppearance();
  const { status, role } = useSession();
  // Live only when signed in. A public/signed-out visitor stays on mock (the
  // /api host routes would 401 them anyway — this just avoids the error spray
  // and gives a clean mock experience); live activates the moment the owner
  // signs in (Settings → Server), since the shared session flips `status`.
  const mode = IS_DEMO || status !== "in" ? "mock" : tweaks.server.mode;
  const api = useMemo(
    () => (mode === "live" ? HttpAdapter({ url: "", role: role ?? "viewer" }) : MockAdapter()),
    [mode, role],
  );
  return <HostApiProvider api={api}>{children}</HostApiProvider>;
}

// The port hook + types live in the framework now; re-export so existing
// `@/lib/os-api` importers keep resolving during the migration to the barrel.
export { useOsApi } from "@/features/appshell";
export type {
  OsApi,
  SysStats,
  FsEntry,
  FsList,
  FsRoot,
  FsUsage,
  FsHit,
  UploadFile,
  UploadResult,
  ExecResult,
  Process,
  HostAccess,
  HostAccessRole,
} from "./types";
