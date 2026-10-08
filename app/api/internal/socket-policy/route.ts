import { NextRequest } from "next/server";
import { constantTimeEq } from "@/lib/auth/session";
import { readRequestJson } from "@/lib/security/request-body";
import { socketPolicy } from "@/lib/managed-apps/socket-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = process.env.MSO_SOCKET_POLICY_SECRET ?? "";
  if (secret.length < 32 || !constantTimeEq(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) return new Response(null, { status: 404 });
  try {
    const input = await readRequestJson(req, 32 * 1024) as { url: string; headers: Record<string, string> };
    const decision = await socketPolicy(new NextRequest(input.url, { headers: input.headers }));
    return Response.json(decision, { status: decision ? 200 : 403, headers: { "Cache-Control": "no-store" } });
  } catch { return new Response(null, { status: 403 }); }
}
