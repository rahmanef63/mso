import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/agent/server";
import { consumeTempShare, inspectTempShare } from "@/lib/host/temp-share-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asciiFilename(name: string): string {
  const safe = name.replace(/[^A-Za-z0-9._ -]/g, "_").replace(/"/g, "_").slice(0, 120);
  return safe || "download.bin";
}

function headers(info: { name: string; mimeType: string; bytes: number; expiresAt: number; downloadsLeft: number }, download: boolean): Headers {
  const disposition = download ? "attachment" : "inline";
  const h = new Headers({
    "content-type": info.mimeType,
    "content-length": String(info.bytes),
    "content-disposition": `${disposition}; filename="${asciiFilename(info.name)}"; filename*=UTF-8''${encodeURIComponent(info.name)}`,
    "cache-control": "private, no-store, no-cache, max-age=0, must-revalidate",
    pragma: "no-cache",
    expires: "0",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    "cross-origin-resource-policy": "same-origin",
    "x-temp-link-expires": new Date(info.expiresAt).toISOString(),
    "x-temp-downloads-left": String(Math.max(info.downloadsLeft, 0)),
  });
  return h;
}

async function authorized(req: Request): Promise<NextResponse | null> {
  if (await verifyAuth(req)) return null;
  return NextResponse.json(
    { error: "unauthorized", detail: "Open MSO and sign in on this approved device, then open the link again." },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

export async function HEAD(req: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await authorized(req);
  if (denied) return denied;
  const { id } = await context.params;
  try {
    const info = await inspectTempShare(id);
    return new Response(null, { status: 200, headers: headers(info, new URL(req.url).searchParams.get("download") === "1") });
  } catch {
    return new Response("Not Found", { status: 404, headers: { "cache-control": "no-store" } });
  }
}

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await authorized(req);
  if (denied) return denied;
  const { id } = await context.params;
  try {
    const share = await consumeTempShare(id);
    return new Response(new Uint8Array(share.data), {
      status: 200,
      headers: headers(share, new URL(req.url).searchParams.get("download") === "1"),
    });
  } catch {
    return new Response("Not Found", { status: 404, headers: { "cache-control": "no-store" } });
  }
}
