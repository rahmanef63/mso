import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/agent/server";
import { listTokens, revokeToken, revokeAllTokens, mintPatToken } from "@/lib/mcp/store";
import { mcpEnabled, maxScope, parseScope, clampScope } from "@/lib/mcp/scope";
import { TOOLS } from "@/lib/mcp/tools";
import { toolsetInfo } from "@/lib/mcp/toolset";
import { publicOrigin } from "@/lib/mcp/origin";

// Token management for Settings → MCP. Under /api on purpose: this one IS
// cookie-authenticated and DOES want the depth-2 CSRF gate in proxy.ts, unlike
// /mcp itself.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await verifyAuth(req, "owner"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ enabled: mcpEnabled(), maxScope: maxScope(), origin: publicOrigin(req), toolset: toolsetInfo(TOOLS), tokens: await listTokens() });
}

export async function POST(req: Request) {
  if (!(await verifyAuth(req, "owner"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!mcpEnabled()) return NextResponse.json({ error: "MCP is disabled on this server" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 });
  }

  const label = typeof body?.label === "string" ? body.label.trim() : "";
  if (!label) return NextResponse.json({ error: "label is required" }, { status: 400 });
  if (label.length > 80) return NextResponse.json({ error: "label must be 80 characters or fewer" }, { status: 400 });

  const rawScope = typeof body?.scope === "string" ? body.scope : "read";
  const scope = clampScope(parseScope(rawScope));

  let ttlDays: number | null = null;
  if (body?.ttlDays !== undefined && body?.ttlDays !== null) {
    const num = Number(body.ttlDays);
    if (isNaN(num) || (num !== 0 && num !== 7 && num !== 30 && num !== 90)) {
      return NextResponse.json({ error: "ttlDays must be 0 (never expires), 7, 30, or 90" }, { status: 400 });
    }
    ttlDays = num === 0 ? null : num;
  }

  const result = await mintPatToken({ label, scope, ttlDays });
  return NextResponse.json({ ok: true, token: result.rawToken, tokenView: result.tokenView }, { status: 201 });
}

export async function DELETE(req: Request) {
  if (!(await verifyAuth(req, "owner"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (id === "all") return NextResponse.json({ revoked: await revokeAllTokens() });
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  return NextResponse.json({ revoked: (await revokeToken(id)) ? 1 : 0 });
}
