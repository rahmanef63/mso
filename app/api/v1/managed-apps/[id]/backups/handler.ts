import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/agent/server";
import { listBackups } from "@/lib/managed-apps/backups";
import { isManagedAppId } from "@/lib/managed-apps/catalog";

export async function handleGetManagedAppBackups(req: Request, id: string): Promise<Response> {
  if (!(await verifyAuth(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isManagedAppId(id)) return NextResponse.json({ error: "unknown managed application" }, { status: 404 });
  return NextResponse.json({ backups: await listBackups(id) });
}
