"use server";

import { requireSession } from "@/lib/auth/require-session";
import { headers } from "next/headers";
import { getClient, storeCode, CODE_TTL_MS } from "@/lib/mcp/store";
import { randomToken, isAllowedRedirect } from "@/lib/mcp/pkce";
import { parseScope, clampScope, mcpEnabled, type Scope } from "@/lib/mcp/scope";
import { detectMcpToolProfile } from "@/lib/mcp/client-profile";

export type ApprovalResult =
  | { ok: false; error: string }
  | { ok: true; redirectTo: string };

// The consent decision remains a Server Action so the signed-in mutation is
// same-origin by construction. Return the validated callback URL to the client and
// let the browser perform an explicit TOP-LEVEL navigation. `redirect()` inside a
// nested client action is transported over a fetch; the callback can complete and
// mint a token while the visible MSO tab stays put, which is exactly what the owner
// observed with ChatGPT.
export async function approve(form: FormData): Promise<ApprovalResult> {
  if (!mcpEnabled()) return { ok: false, error: "MCP is disabled on this server." };
  // The session cookie is the ONLY thing authorizing this. Re-checked here and not
  // inherited from the page render — a page can be cached, an action cannot.
  if (!(await requireSession("owner"))) return { ok: false, error: "Not signed in." };

  const clientId = String(form.get("client_id") ?? "");
  const redirectUri = String(form.get("redirect_uri") ?? "");
  const challenge = String(form.get("code_challenge") ?? "");
  const method = String(form.get("code_challenge_method") ?? "");
  const state = String(form.get("state") ?? "");
  const resource = String(form.get("resource") ?? "");
  const issuer = String(form.get("issuer") ?? "");
  const offlineAccess = String(form.get("offline_access") ?? "") === "1";
  const scope: Scope = clampScope(parseScope(String(form.get("scope") ?? "read")));

  if (method !== "S256" || !challenge) return { ok: false, error: "This client did not use PKCE S256, which mso requires." };
  if (!isAllowedRedirect(redirectUri)) return { ok: false, error: "The redirect target is not https (or localhost)." };
  const configured = process.env.OS_PUBLIC_ORIGIN?.trim();
  let expectedIssuer = "";
  if (configured) { try { expectedIssuer = new URL(configured).origin; } catch {} }
  if (!expectedIssuer) {
    const h = await headers(), proto = h.get("x-forwarded-proto")?.split(",")[0].trim() || "https", host = h.get("host") ?? h.get("x-forwarded-host") ?? "";
    try { expectedIssuer = new URL(`${proto}://${host}`).origin; } catch {}
  }
  if (!expectedIssuer || issuer !== expectedIssuer || resource !== `${expectedIssuer}/mcp`) return { ok: false, error: "OAuth resource/issuer mismatch." };

  const client = await getClient(clientId);
  // A user-defined client (ChatGPT's flow) never registers, so it has no record
  // here. That is allowed — the redirect_uri is still https-checked above and the
  // code is still bound to this exact client_id + redirect_uri at exchange. What
  // is NOT allowed is a REGISTERED client redirecting somewhere it never declared.
  if (client && !client.redirectUris.includes(redirectUri)) {
    return { ok: false, error: "That redirect target is not registered for this client." };
  }

  const code = randomToken("mso_code_");
  await storeCode(code, {
    clientId,
    redirectUri,
    codeChallenge: challenge,
    scope,
    resource,
    profile: client?.profile ?? detectMcpToolProfile({ clientId, name: client?.name, redirectUris: client?.redirectUris ?? [redirectUri] }),
    offlineAccess,
    expiresAt: Date.now() + CODE_TTL_MS,
  });

  const dest = new URL(redirectUri);
  dest.searchParams.set("code", code);
  if (state) dest.searchParams.set("state", state);
  dest.searchParams.set("iss", issuer);
  return { ok: true, redirectTo: dest.toString() };
}
