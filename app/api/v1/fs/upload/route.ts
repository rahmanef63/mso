import { NextResponse } from "next/server";
import { text } from "node:stream/consumers";
import { verifyAuth } from "@/lib/agent/server";
import { getSessionActor } from "@/lib/auth/require-session";
import { apiError, invalidRequest } from "@/lib/host/request-api";
import { audit } from "@/lib/host/audit-api";
import { boundaryFromContentType, parseMultipart, resolveUploadDest, streamFileInto, UploadTooLargeError } from "@/lib/host/fs-api";
import { rateLimited } from "@/lib/host/limits-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Burst guard (same limiter as /exec/run); per-actor bucket. Bandwidth-heavy → tightest cap.
const FS_UPLOAD_MAX = 20;
const FS_UPLOAD_WINDOW_MS = 60_000;

// Total request cap, enforced as a RUNNING counter across all parts BEFORE
// buffering past it (the body never lands fully in RAM — each part streams to a
// temp file). Sits below next.config `proxyClientMaxBodySize` (256mb).
const MAX_TOTAL = 200 * 1024 * 1024; // 200 MiB

// POST multipart/form-data {dest, file[]} → stream each file (binary-safe) into
// dest within WRITE roots. Each `file` part's filename carries its relPath, so
// dropped folders keep their structure. The client sends `dest` first.
export async function POST(req: Request) {
  if (!(await verifyAuth(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const actor = await getSessionActor();
  if (rateLimited(`fs.upload:${actor ?? "anon"}`, FS_UPLOAD_MAX, FS_UPLOAD_WINDOW_MS)) {
    audit({ action: "fs.upload", actor, ok: false, detail: "rate-limited" });
    return NextResponse.json({ error: "Too many upload requests, slow down" }, { status: 429 });
  }

  let boundary: string;
  try {
    boundary = boundaryFromContentType(req.headers.get("content-type"));
  } catch {
    return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });
  }
  if (!req.body) return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });

  let dest: string | undefined;
  let destReal: string | undefined;
  let written = 0;
  const failed: string[] = [];

  try {
    for await (const part of parseMultipart(req.body, boundary, MAX_TOTAL)) {
      if (part.filename === undefined) {
        // Plain text field (dest). Buffer it (tiny) and resolve the target dir.
        if (part.name === "dest") {
          dest = (await text(part.body)).trim();
          if (dest) destReal = await resolveUploadDest(dest);
        } else {
          await drainPart(part.body);
        }
        continue;
      }
      if (!destReal) {
        // `file` arrived before a valid `dest` — unsupported ordering.
        await drainPart(part.body);
        failed.push(part.filename || "(unnamed)");
        continue;
      }
      const r = await streamFileInto(destReal, part.filename, part.body);
      if (r === "ok") written++;
      else failed.push(part.filename + (r === "too-large" ? " (too large)" : ""));
    }
  } catch (e) {
    if (e instanceof UploadTooLargeError) {
      audit({ action: "fs.upload", actor, target: dest ?? "", ok: false, detail: String(e) });
      return NextResponse.json({ error: String(e.message) }, { status: 413 });
    }
    audit({ action: "fs.upload", actor, target: dest ?? "", ok: false, detail: String(e) });
    return apiError("fs/upload", e);
  }

  if (typeof dest !== "string" || !dest) return invalidRequest("dest");

  audit({
    action: "fs.upload",
    actor,
    target: dest,
    ok: failed.length === 0,
    detail: `${written} written${failed.length ? `, ${failed.length} failed` : ""}`,
  });
  return NextResponse.json({ written, failed });
}

async function drainPart(body: AsyncIterable<Uint8Array>): Promise<void> {
  for await (const _chunk of body) void _chunk;
}
