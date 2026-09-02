import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/agent/server";
import { apiError } from "@/lib/host/request-api";
import { readFile } from "@/lib/host/fs-api";

export const dynamic = "force-dynamic";

// os-rr GET /fs/read?path= → raw utf8 string of the file.
export async function GET(req: Request) {
  if (!(await verifyAuth(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const path = new URL(req.url).searchParams.get("path") ?? "~";
  try {
    return NextResponse.json(await readFile(path));
  } catch (e) {
    return apiError("fs/read", e);
  }
}
