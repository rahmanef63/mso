import { NextResponse } from "next/server";
import { Readable } from "stream";
import { verifyAuth } from "@/lib/agent/server";
import { apiError } from "@/lib/host/request-api";
import { fileStream, statReadable } from "@/lib/host/fs-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Raw file bytes for media preview (image/video/audio/pdf). Same-origin so the
// session cookie authenticates it directly as an <img>/<video>/<audio> src.
// Supports HTTP Range (206) so video/audio can seek and stream.
export async function GET(req: Request) {
  if (!(await verifyAuth(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const path = new URL(req.url).searchParams.get("path") ?? "";
  if (!path) return NextResponse.json({ error: "path required" }, { status: 400 });

  let info: { path: string; size: number; mime: string };
  try {
    info = await statReadable(path);
  } catch (e) {
    return apiError("fs/raw", e, { status: 404, error: "Not found" });
  }

  const base: Record<string, string> = {
    "content-type": info.mime,
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=60",
  };
  // SVG served same-origin is active content: a hand-crafted <svg><script> runs
  // in our origin on DIRECT navigation (the global CSP has no script-src) and
  // could fire authed same-origin fetches (→ exec/RCE). `sandbox` neutralises
  // scripts when the SVG is loaded as a document; <img>/<image> previews are
  // unaffected (browsers never script SVG loaded as an image).
  if (info.mime === "image/svg+xml") base["content-security-policy"] = "sandbox";
  const toWeb = (s: ReturnType<typeof fileStream>) =>
    Readable.toWeb(s) as unknown as ReadableStream;

  const range = req.headers.get("range");
  const m = range && /bytes=(\d*)-(\d*)/.exec(range);
  if (m) {
    let start = m[1] ? parseInt(m[1], 10) : 0;
    let end = m[2] ? parseInt(m[2], 10) : info.size - 1;
    if (Number.isNaN(start)) start = 0;
    if (Number.isNaN(end) || end >= info.size) end = info.size - 1;
    if (start > end || start >= info.size) {
      return new Response(null, {
        status: 416,
        headers: { "content-range": `bytes */${info.size}` },
      });
    }
    return new Response(toWeb(fileStream(info.path, start, end)), {
      status: 206,
      headers: {
        ...base,
        "content-range": `bytes ${start}-${end}/${info.size}`,
        "content-length": String(end - start + 1),
      },
    });
  }

  return new Response(toWeb(fileStream(info.path)), {
    status: 200,
    headers: { ...base, "content-length": String(info.size) },
  });
}
