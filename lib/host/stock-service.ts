import { json } from "@/lib/api/route";
import { verifyAuth } from "@/lib/agent/server";
import { apiError, invalidRequest } from "@/lib/host/request-api";
import { searchOpenverse, searchUnsplash } from "@/app/api/v1/stock/providers";

export async function handleStockSearch(req: Request): Promise<Response> {
  if (!(await verifyAuth(req))) {
    return json({ error: "unauthorized" }, 401);
  }

  const params = new URL(req.url).searchParams;
  const q = (params.get("q") ?? "").trim();
  if (!q) return invalidRequest("q");
  const page = Math.max(1, Math.trunc(Number(params.get("page"))) || 1);

  try {
    const key = process.env.OS_UNSPLASH_ACCESS_KEY?.trim();
    const results = key ? await searchUnsplash(q, page, key) : await searchOpenverse(q, page);
    return json({ results });
  } catch (e) {
    return apiError("stock/search", e, { status: 502, error: "Stock search failed" });
  }
}
