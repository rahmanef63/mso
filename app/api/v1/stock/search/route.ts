import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/agent/server";
import { apiError, invalidRequest } from "@/lib/host/request-api";
import { searchOpenverse, searchUnsplash } from "../providers";

export const dynamic = "force-dynamic";

// GET /stock/search?q=…&page=1 → { results: [{ id, thumb, url, title,
// creator, license }] }. Unsplash search when OS_UNSPLASH_ACCESS_KEY is set,
// keyless Openverse fallback otherwise — the client shape is identical.
export async function GET(req: Request) {
  if (!(await verifyAuth(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const q = (params.get("q") ?? "").trim();
  if (!q) return invalidRequest("q");
  const page = Math.max(1, Math.trunc(Number(params.get("page"))) || 1);

  try {
    const key = process.env.OS_UNSPLASH_ACCESS_KEY?.trim();
    const results = key ? await searchUnsplash(q, page, key) : await searchOpenverse(q, page);
    return NextResponse.json({ results });
  } catch (e) {
    return apiError("stock/search", e, { status: 502, error: "Stock search failed" });
  }
}
