import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { OsRoot } from "../os-root";
import { getSessionContext } from "@/lib/auth/require-session";
import { chatGptMcpLanding } from "../external-open";

// Optional catch-all: the OS is one client shell, but every app is deep-linkable
// (`/files/home/user`, `/code`, `/terminal`). The shell reads the path on the
// client to open the right window (see appshell UrlSync); here we only set a
// per-route <title> from the first segment so shared links read well.
//
// A missing `/_next/static/*` chunk (e.g. an open tab whose old build was
// redeployed) would otherwise fall through to this catch-all and return the app
// HTML with a 200 — the browser then refuses it as the wrong MIME and can't
// recover. `_next` is never an app slug, and real static files are served before
// routing, so any `_next` request that reaches here is a genuine miss → 404,
// which lets the client router hard-reload onto the new build.
//
// `api` is reserved for the same reason plus one of its own: real handlers under
// app/api/** match before this catch-all, so anything still landing here is a
// nonexistent endpoint — and returning the app HTML with a 200 made a dead route
// indistinguishable from a live one. It also shipped that HTML with NO Content-
// Security-Policy, because proxy.ts skips the CSP branch for `/api/`.
function isReserved(slug?: string[]): boolean {
  return slug?.[0] === "_next" || slug?.[0] === "api";
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const first = slug?.[0];
  if (!first || isReserved(slug)) return { title: "Manef Shell OS — browser-based server control plane" };
  const name = first.charAt(0).toUpperCase() + first.slice(1);
  return { title: `${name} — MSO` };
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ slug?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  if (isReserved(slug)) notFound();
  // ChatGPT's external-open bridge appends the conversation as `redirectUrl`.
  // A root landing with that marker is not a normal desktop launch: surface the
  // in-shell MCP activity immediately so "Open in MSO" has a visible result.
  // The callback is preserved for the host/browser; MSO never follows it.
  const externalLanding = chatGptMcpLanding(slug, query.redirectUrl);
  if (externalLanding) redirect(externalLanding);
  // Resolve the session on the server (reads the signed cookie) and inject it as
  // SessionProvider's initial state → the shell paints on the first render with
  // no client /api/auth/me probe and no Splash. cookies() makes this dynamic —
  // intended (the app is never SSG; next.config cacheComponents:false).
  const context = await getSessionContext();
  const initialStatus = context ? "in" : "out";
  return <OsRoot initialStatus={initialStatus} initialRole={context?.role ?? null} />;
}
