import { NextResponse } from "next/server";
import { Readable } from "stream";
import { verifyAuth } from "@/lib/agent/server";
import { getSessionActor } from "@/lib/auth/require-session";
import { apiError } from "@/lib/host/request-api";
import { audit } from "@/lib/host/audit-api";
import { rateLimited } from "@/lib/host/limits-api";
import { zipStream } from "@/lib/host/fs-api";

const FS_ZIP_MAX = 20;
const FS_ZIP_WINDOW_MS = 60_000;

export async function handleGetFsZip(req: Request): Promise<Response> {
  if (!(await verifyAuth(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const actor = await getSessionActor();
  if (rateLimited(`fs.zip:${actor ?? "anon"}`, FS_ZIP_MAX, FS_ZIP_WINDOW_MS)) {
    audit({ action: "fs.zip", actor, ok: false, detail: "rate-limited" });
    return NextResponse.json({ error: "Too many download requests, slow down" }, { status: 429 });
  }

  const url = new URL(req.url);
  const base = url.searchParams.get("base") ?? "";
  const names = url.searchParams.getAll("n");
  const exclude = url.searchParams.getAll("x");
  const filename = (url.searchParams.get("name") || "archive.zip").replace(/[^\w.\-]+/g, "_");
  if (!base || !names.length)
    return NextResponse.json({ error: "base + n required" }, { status: 400 });

  try {
    const stream = await zipStream(base, names, exclude);
    audit({ action: "fs.zip", actor, target: base, ok: true, detail: `${names.length} items, skip ${exclude.length}` });
    return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
      status: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    audit({ action: "fs.zip", actor, target: base, ok: false, detail: String(e) });
    return apiError("fs/zip", e);
  }
}
