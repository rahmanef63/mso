import { NextRequest, NextResponse } from "next/server";
import { completeGoogleAuthorization, googleFlowCookie } from "@/lib/infra/google-oauth-flow";
import { googlePublicOrigin } from "@/lib/infra/google-native-config";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
export async function GET(req: NextRequest) {
  let origin: string;
  try { origin = googlePublicOrigin(); } catch { return NextResponse.json({ error: "google_public_https_origin_required" }, { status: 409, headers }); }
  if (req.headers.get("host")?.toLowerCase() !== new URL(origin).host) return NextResponse.json({ error: "invalid_google_callback" }, { status: 400, headers });
  const params = req.nextUrl.searchParams, state = params.get("state") || "";
  let success = false;
  try {
    if (!/^[A-Za-z0-9_-]{43}$/.test(state) || ["state", "code", "error", "iss"].some(k => params.getAll(k).length > 1) || (params.has("code") && params.has("error")) || (params.has("iss") && params.get("iss") !== "https://accounts.google.com")) throw new Error();
    const cookies = req.cookies.getAll(googleFlowCookie(state)); if (cookies.length !== 1) throw new Error();
    await completeGoogleAuthorization(state, cookies[0].value, params.get("code") ?? undefined, params.has("error"));
    success = true;
  } catch { /* No provider text, codes, tokens, state or callback URLs are reflected or logged. */ }
  const response = NextResponse.redirect(`${origin}/integrations?google=${success ? "authorized" : "retry"}`, { status: 303, headers });
  if (/^[A-Za-z0-9_-]{43}$/.test(state)) response.cookies.set(googleFlowCookie(state), "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}
