import { NextRequest } from "next/server";
import { handlePostLogin } from "./handler";
export { clientIp } from "@/lib/host/request-ip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return handlePostLogin(req);
}
