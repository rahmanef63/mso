import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { requireSession } from "@/lib/auth/require-session";
import { getClient } from "@/lib/mcp/store";
import { isAllowedRedirect } from "@/lib/mcp/pkce";
import { denyUrl, selfUrl } from "@/lib/mcp/redirect";
import { mcpEnabled, maxScope } from "@/lib/mcp/scope";
import { ConsentForm } from "./consent-form";

// OAuth consent. Renders only for a signed-in owner; everything it needs to mint
// a code is carried in the query string and re-validated in the action.
export const dynamic = "force-dynamic";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main id="main-content" className="grid min-h-dvh place-items-center bg-background p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">{children}</div>
    </main>
  );
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!mcpEnabled()) notFound();
  const q = await searchParams;
  const one = (k: string) => (Array.isArray(q[k]) ? q[k][0] : q[k]) ?? "";

  const clientId = one("client_id");
  const h = await headers();
  const configured = process.env.OS_PUBLIC_ORIGIN?.trim();
  const proto = h.get("x-forwarded-proto")?.split(",")[0].trim() || "https";
  const host = h.get("host") ?? h.get("x-forwarded-host") ?? "";
  const issuer = (() => { try { return configured ? new URL(configured).origin : new URL(`${proto}://${host}`).origin; } catch { return ""; } })();
  const expectedResource = issuer ? `${issuer}/mcp` : "";
  const resource = one("resource") || expectedResource;
  const offlineAccess = one("scope").split(/\s+/).includes("offline_access");
  const redirectUri = one("redirect_uri");
  const challenge = one("code_challenge");
  const method = one("code_challenge_method");

  if (!(await requireSession())) {
    // The request is KEPT. This used to link to `/` and tell the visitor to
    // "start the connection again from the client", which threw the whole
    // authorization request away: ChatGPT had already generated its PKCE
    // verifier and state, so going back meant restarting the flow from the
    // connector dialog — and most people read that screen as "it is broken".
    //
    // mso's unlock is a client-side gate over a JSON login route, so there is no
    // server-side `?next=` to hand off to. What works without inventing one: put
    // the unlock in a SECOND tab and leave this one where it is. The session is
    // a cookie, so once it exists this exact URL renders the consent screen —
    // Continue is a plain re-request of the same query string, nothing stored.
    const here = selfUrl(q);
    return (
      <Shell>
        <h1 className="text-lg font-semibold">Unlock mso to continue</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This page cannot authorize anything on its own — it needs your signed-in session. Unlock mso in
          a new tab, then come back here and press Continue. <strong>Do not close this tab:</strong> it is
          holding the request the client just made.
        </p>
        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          <a className="underline" href="/" target="_blank" rel="noopener noreferrer">
            Unlock mso in a new tab
          </a>
          <Link className="underline" href={here} prefetch={false}>
            Continue
          </Link>
        </div>
      </Shell>
    );
  }

  // Fail loudly and specifically BEFORE showing an Allow button — a consent screen
  // that approves a malformed request is worse than one that refuses to render.
  const problem =
    !clientId ? "The client did not send a client_id."
    : !isAllowedRedirect(redirectUri) ? "The client's redirect target is missing, or is not https (or localhost)."
    : method !== "S256" || !challenge ? "The client did not use PKCE with S256, which mso requires."
    : !issuer || resource !== expectedResource ? "The OAuth resource does not match this MSO MCP endpoint."
    : null;

  if (problem) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold">Cannot connect this client</h1>
        <p className="mt-2 text-sm text-muted-foreground">{problem}</p>
      </Shell>
    );
  }

  const client = await getClient(clientId);

  // Where Cancel goes. Built HERE, from the redirect target this page already
  // validated, rather than in the browser — the deny path must not be the one
  // place a URL gets assembled from unchecked input.
  //
  // A refusal is REPORTED, not just navigated away from. Cancel used to call
  // `history.back()`, which tells the client nothing at all: ChatGPT sits on its
  // connector dialog waiting for a callback that will never arrive, and the user
  // sees a spinner rather than "you declined". RFC 6749 §4.1.2.1 — and `state`
  // rides along, because a client that cannot match the response to its own
  // request is required to discard it.
  const deny = denyUrl(redirectUri, one("state"), issuer);

  return (
    <Shell>
      <ConsentForm
        clientName={client?.name ?? clientId}
        redirectUri={redirectUri}
        denyUrl={deny}
        ceiling={maxScope()}
        hidden={{
          client_id: clientId,
          redirect_uri: redirectUri,
          code_challenge: challenge,
          code_challenge_method: method,
          state: one("state"),
          resource,
          issuer,
          offline_access: offlineAccess ? "1" : "0",
        }}
      />
    </Shell>
  );
}
