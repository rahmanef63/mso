import { handleGetSysPackages } from "@/lib/host/sys-packages-service";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handleGetSysPackages(req);
}
