import { handleGetSysServices, handlePostSysServices } from "@/lib/host/sys-services-service";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handleGetSysServices(req);
}

export async function POST(req: Request) {
  return handlePostSysServices(req);
}
