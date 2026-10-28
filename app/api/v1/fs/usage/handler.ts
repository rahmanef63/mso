import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/agent/server";
import { apiError } from "@/lib/host/request-api";
import { usage } from "@/lib/host/fs-api";

export async function handleGetFsUsage(req: Request): Promise<Response> {
  if (!(await verifyAuth(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const path = new URL(req.url).searchParams.get("path") ?? "~";
  try {
    return NextResponse.json(await usage(path));
  } catch (e) {
    return apiError("fs/usage", e);
  }
}
