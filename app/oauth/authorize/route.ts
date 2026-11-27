// Web-standard OAuth consent route handler (GET renders consent HTML, POST approves).
// Replaces the legacy Next.js Server Component + React ConsentForm with zero React/Next UI dependency.

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { getClient, isAutoRegisterableClientId } from "@/lib/mcp/store";
import { isAllowedRedirect } from "@/lib/mcp/pkce";
import { denyUrl, selfUrl } from "@/lib/mcp/redirect";
import { defaultConsentScope, maxScope, mcpEnabled, type Scope } from "@/lib/mcp/scope";
import { approve } from "./actions";

const TIERS: { value: Scope; label: string; blurb: string }[] = [
  { value: "read", label: "Read only", blurb: "List and read files, disk usage, CPU/memory, processes, installed apps." },
  { value: "write", label: "Read + change settings and files", blurb: "Create, overwrite, move, copy and delete files; change workflows, agent identities, integrations and DNS." },
  { value: "exec", label: "Full shell", blurb: "Everything above, plus run any shell command as you, and power the browser session." },
];

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function htmlPage(title: string, body: string, status = 200, callback?: string): NextResponse {
  // Chromium can block a cross-origin redirect chained from a form with
  // form-action 'self'. A fresh document ends that chain without relaxing CSP.
  // The URL comes only from approve(), which validates the callback and issuer.
  const handoff = callback ? `<meta http-equiv="refresh" content="1; url=${esc(callback)}">` : "";
  const doc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>${handoff}<style>body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:#0b0f17;color:#f3f4f6;display:grid;grid-template-columns:minmax(0,1fr);min-height:100dvh;box-sizing:border-box;place-items:center;padding:16px}.card{box-sizing:border-box;width:100%;max-width:440px;min-width:0;border:1px solid #1f2937;border-radius:16px;background:#111827;padding:24px;box-shadow:0 20px 25px -5px rgba(0,0,0,.5)}h1{font-size:18px;margin:0 0 8px}p{font-size:13px;color:#9ca3af;line-height:1.5;margin:8px 0}.box{border:1px solid #1f2937;background:#0b0f17;border-radius:8px;padding:12px;font-size:12px;margin:14px 0}.mono{font-family:ui-monospace,monospace;word-break:break-all;color:#e5e7eb;margin-top:4px}fieldset{border:0;padding:0;margin:14px 0}legend{font-size:13px;font-weight:600;margin-bottom:8px}.tier{display:flex;gap:10px;border:1px solid #1f2937;border-radius:8px;padding:10px;margin-bottom:8px;cursor:pointer}.actions{display:flex;gap:8px;margin-top:16px}button,.btn{flex:1;display:inline-flex;justify-content:center;align-items:center;min-height:40px;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;cursor:pointer;border:1px solid #374151;background:#2563eb;color:#fff}.btn-secondary{background:transparent;color:#d1d5db}a{color:#60a5fa}</style></head><body><main id="main-content" class="card">${body}</main></body></html>`;
  return new NextResponse(doc, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });
}

function resolveIssuer(h: Headers): string {
  const configured = process.env.OS_PUBLIC_ORIGIN?.trim();
  const forwardedHost = h.get("x-forwarded-host")?.split(",")[0].trim();
  const host = forwardedHost || h.get("host")?.trim() || "";
  const isLoopback = host.startsWith("localhost") || host.startsWith("127.") || host.startsWith("[::1]");
  const proto = h.get("x-forwarded-proto")?.split(",")[0].trim() || (isLoopback ? "http" : "https");
  try {
    return configured ? new URL(configured).origin : new URL(`${proto}://${host}`).origin;
  } catch {
    return "";
  }
}

export async function GET(req: Request): Promise<NextResponse> {
  if (!mcpEnabled()) return htmlPage("Not Found", "<h1>Not Found</h1>", 404);
  const url = new URL(req.url);
  const q: Record<string, string> = {};
  url.searchParams.forEach((v, k) => { if (!(k in q)) q[k] = v; });
  const one = (k: string) => q[k] ?? "";

  const clientId = one("client_id");
  const issuer = resolveIssuer(req.headers);
  const expectedResource = issuer ? `${issuer}/mcp` : "";
  const resource = one("resource") || expectedResource;
  const offlineAccess = one("scope").split(/\s+/).includes("offline_access");
  const redirectUri = one("redirect_uri");
  const challenge = one("code_challenge");
  const method = one("code_challenge_method");

  if (!(await requireSession())) {
    const here = selfUrl(q);
    return htmlPage(
      "Unlock mso to continue",
      `<h1>Unlock mso to continue</h1><p>This page needs your signed-in session. Unlock mso in a new tab, then come back here and press Continue. <strong>Do not close this tab.</strong></p><div class="actions"><a class="btn btn-secondary" href="/" target="_blank" rel="noopener noreferrer">Unlock mso in a new tab</a><a class="btn" href="${esc(here)}">Continue</a></div>`,
    );
  }

  const provided = (await getClient(clientId)) ?? (
    isAutoRegisterableClientId(clientId)
      ? { name: clientId, redirectUris: [redirectUri], createdAt: 0 }
      : null
  );
  const problem =
    !clientId ? "The client did not send a client_id."
    : !provided ? "This client must register before requesting authorization."
    : !provided.redirectUris.includes(redirectUri) ? "That redirect target is not registered for this client."
    : !isAllowedRedirect(redirectUri) ? "The client's redirect target is missing, or is not https (or localhost)."
    : method !== "S256" || !challenge ? "The client did not use PKCE with S256, which mso requires."
    : !issuer || resource !== expectedResource ? "The OAuth resource does not match this MSO MCP endpoint."
    : null;

  if (problem) {
    return htmlPage("Cannot connect this client", `<h1>Cannot connect this client</h1><p>${esc(problem)}</p>`, 400);
  }

  const ceiling = maxScope();
  const allowed = TIERS.slice(0, TIERS.findIndex((t) => t.value === ceiling) + 1);
  const preselected = defaultConsentScope(ceiling);
  const deny = denyUrl(redirectUri, one("state"), issuer);
  const hidden: Record<string, string> = {
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: method,
    state: one("state"),
    resource,
    issuer,
    offline_access: offlineAccess ? "1" : "0",
  };
  const hiddenInputs = Object.entries(hidden)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join("");
  const tierInputs = allowed
    .map(
      (t) =>
        `<label class="tier"><input type="radio" name="scope" value="${esc(t.value)}"${t.value === preselected ? " checked" : ""}><span><strong>${esc(t.label)}</strong><br><small style="color:#9ca3af">${esc(t.blurb)}</small></span></label>`,
    )
    .join("");
  const cancelBtn = deny ? `<a class="btn btn-secondary" href="${esc(deny)}">Cancel</a>` : "";

  return htmlPage(
    `Connect ${provided?.name ?? clientId}`,
    `<form method="POST" action="/oauth/authorize">${hiddenInputs}<h1>Connect ${esc(provided?.name ?? clientId)} to your VPS</h1><p>It will be able to act on this machine as you until you revoke it in Settings → MCP.</p><div class="box"><span>Sends the result to</span><div class="mono">${esc(redirectUri)}</div></div><fieldset><legend>What it may do</legend>${tierInputs}</fieldset><div class="actions"><button type="submit">Allow</button>${cancelBtn}</div></form>`,
  );
}

export async function POST(req: Request): Promise<NextResponse> {
  const form = await req.formData();
  const result = await approve(form);
  if (!result.ok) {
    return htmlPage("Authorization refused", `<h1>Authorization refused</h1><p role="alert">${esc(result.error)}</p>`, 400);
  }
  return htmlPage(
    "Authorization approved",
    `<h1>Authorization approved</h1><p>Returning to the app that requested access. If it does not open automatically, select Continue.</p><div class="actions"><a class="btn" href="${esc(result.redirectTo)}" rel="noreferrer">Continue</a></div>`,
    200,
    result.redirectTo,
  );
}
