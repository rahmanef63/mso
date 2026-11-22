import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/agent/server";
import { apiError } from "@/lib/host/request-api";
import { usage, usageDefaultPath } from "@/lib/host/fs-api";

export async function handleGetFsUsage(req: Request): Promise<Response> {
  if (!(await verifyAuth(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // No explicit path means "the disk the cockpit lives on". `~` is not a readable
  // root by default, so defaulting to it made this route fail closed for every
  // caller that omitted the parameter (the Storage widget, Settings -> About).
  const path = new URL(req.url).searchParams.get("path") ?? usageDefaultPath();
  try {
    return NextResponse.json(await usage(path));
  } catch (e) {
    return apiError("fs/usage", e);
  }
}
