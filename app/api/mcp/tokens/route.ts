import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/agent/server";
import { listTokens, revokeToken, revokeAllTokens } from "@/lib/mcp/store";
import { mcpEnabled, maxScope } from "@/lib/mcp/scope";
import { TOOLS } from "@/lib/mcp/tools";
import { toolsetInfo } from "@/lib/mcp/toolset";

// Token management for Settings → MCP. Under /api on purpose: this one IS
// cookie-authenticated and DOES want the depth-2 CSRF gate in proxy.ts, unlike
// /mcp itself. There is no mint endpoint — tokens only ever come from the OAuth
// consent flow, so a stolen session cannot silently create a standing bearer
// without the owner seeing the consent screen.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await verifyAuth(req, "owner"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ enabled: mcpEnabled(), maxScope: maxScope(), toolset: toolsetInfo(TOOLS), tokens: await listTokens() });
}

export async function DELETE(req: Request) {
  if (!(await verifyAuth(req, "owner"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (id === "all") return NextResponse.json({ revoked: await revokeAllTokens() });
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  return NextResponse.json({ revoked: (await revokeToken(id)) ? 1 : 0 });
}
