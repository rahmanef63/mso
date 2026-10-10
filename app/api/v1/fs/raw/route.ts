import { NextResponse } from "next/server";
import { Readable } from "stream";
import { verifyAuth } from "@/lib/agent/server";
import { apiError } from "@/lib/host/request-api";
import { fileStream, statReadable } from "@/lib/host/fs-api";
import { getSessionActor } from "@/lib/auth/require-session";
import { readAdmission, ReadBusyError } from "@/lib/read-admission";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const admitStream = readAdmission(4, 16);

// Raw file bytes for media preview (image/video/audio/pdf). Same-origin so the
// session cookie authenticates it directly as an <img>/<video>/<audio> src.
// Supports HTTP Range (206) so video/audio can seek and stream.
export async function GET(req: Request) {
  if (!(await verifyAuth(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const path = new URL(req.url).searchParams.get("path") ?? "";
  if (!path) return NextResponse.json({ error: "path required" }, { status: 400 });
  const actor = await getSessionActor();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let release: () => void;
  try { release = admitStream(actor); }
  catch (error) {
    if (error instanceof ReadBusyError) return NextResponse.json({ error: "file_streams_busy" }, { status: 429 });
    throw error;
  }

  let info: Awaited<ReturnType<typeof statReadable>>;
  try {
    info = await statReadable(path);
  } catch (e) {
    release();
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
  const toWeb = (s: ReturnType<typeof fileStream>) => {
    let idle: ReturnType<typeof setTimeout>;
    const expire = () => s.destroy(new Error("raw file stream deadline exceeded"));
    const resetIdle = () => { clearTimeout(idle); idle = setTimeout(expire, 10_000); idle.unref?.(); };
    const total = setTimeout(expire, 60_000); total.unref?.();
    const abort = () => s.destroy(new Error("raw file request aborted"));
    s.once("close", () => { clearTimeout(idle); clearTimeout(total); req.signal.removeEventListener("abort", abort); release(); });
    s.on("data", resetIdle);
    req.signal.addEventListener("abort", abort, { once: true });
    resetIdle();
    const web = Readable.toWeb(s, { strategy: { highWaterMark: 64 * 1024, size: chunk => chunk.byteLength } }) as ReadableStream;
    if (req.signal.aborted) abort();
    return web;
  };
  const refuse = async (status: number, error: string) => {
    try { await info.handle.close(); } finally { release(); }
    return NextResponse.json({ error }, { status, headers: { "content-range": `bytes */${info.size}`, "accept-ranges": "bytes" } });
  };

  const range = req.headers.get("range");
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range);
  if (range && (!m || (!m[1] && !m[2]))) return refuse(416, "invalid range");
  if (m) {
    let start = m[1] ? parseInt(m[1], 10) : Math.max(0, info.size - Number(m[2]));
    let end = m[1] && m[2] ? parseInt(m[2], 10) : info.size - 1;
    if (Number.isNaN(start)) start = 0;
    if (Number.isNaN(end) || end >= info.size) end = info.size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size) return refuse(416, "invalid range");
    end = Math.min(end, start + MAX_RESPONSE_BYTES - 1);
    return new Response(toWeb(fileStream(info.handle, start, end)), {
      status: 206,
      headers: {
        ...base,
        "content-range": `bytes ${start}-${end}/${info.size}`,
        "content-length": String(end - start + 1),
      },
    });
  }
  if (info.size > MAX_RESPONSE_BYTES) return refuse(413, "large files require a bounded byte range");
  if (info.size === 0) {
    try { await info.handle.close(); } finally { release(); }
    return new Response(null, { headers: { ...base, "content-length": "0" } });
  }

  return new Response(toWeb(fileStream(info.handle, 0, Math.max(0, info.size - 1))), {
    status: 200,
    headers: { ...base, "content-length": String(info.size) },
  });
}
