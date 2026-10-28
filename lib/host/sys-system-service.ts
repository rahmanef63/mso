import { json } from "@/lib/api/route";
import { verifyAuth } from "@/lib/agent/server";
import { apiError } from "@/lib/host/request-api";
import { processes, stats } from "@/lib/host/system-api";

export async function handleGetSysProcesses(req: Request): Promise<Response> {
  if (!(await verifyAuth(req))) {
    return json({ error: "unauthorized" }, 401);
  }
  try {
    return json(await processes());
  } catch (e) {
    return apiError("sys/processes", e);
  }
}

export async function handleGetSysStats(req: Request): Promise<Response> {
  if (!(await verifyAuth(req))) {
    return json({ error: "unauthorized" }, 401);
  }
  try {
    return json(await stats());
  } catch (e) {
    return apiError("sys/stats", e);
  }
}
