import { handleStockSearch } from "@/lib/host/stock-service";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handleStockSearch(req);
}
