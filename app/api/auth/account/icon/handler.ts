import { NextRequest, NextResponse } from "next/server";
import { AccountProfileError, readAccountProfile, writeAccountProfile } from "@/lib/auth/account-profile";
import {
  AccountIconError,
  accountIconPng,
  buildIco,
  convertAccountIcon,
  MAX_INPUT_BYTES,
} from "@/lib/auth/account-icon-image";
import { getSessionContext } from "@/lib/auth/require-session";
import { managedAppIdForHost, isUnclaimedAppNamespaceHost } from "@/lib/managed-apps/origin";
import { audit } from "@/lib/host/audit-api";
import { IS_DEMO } from "@/lib/demo";

const noStore = { "Cache-Control": "no-store" };
const PUBLIC_CACHE = "public, max-age=60, stale-while-revalidate=300";
const ICO_SIZES = [16, 32, 48] as const;
const SIZES = { "32": 32, "180": 180, "192": 192, "512": 512 } as const;

export async function handleGetAccountIcon(req: NextRequest): Promise<Response> {
  const raw = req.nextUrl.searchParams.get("size") ?? "192";
  try {
    const { icon } = await readAccountProfile();
    if (raw === "ico") {
      const pngs = await Promise.all(ICO_SIZES.map((size) => accountIconPng(icon, size)));
      const ico = buildIco(ICO_SIZES.map((size, index) => ({ size, png: pngs[index]! })));
      return new NextResponse(new Uint8Array(ico), {
        headers: { "Content-Type": "image/x-icon", "Cache-Control": PUBLIC_CACHE, "X-Content-Type-Options": "nosniff" },
      });
    }
    const size = SIZES[(raw in SIZES ? raw : "192") as keyof typeof SIZES];
    const png = await accountIconPng(icon, size);
    if (!png.length) return new NextResponse(null, { status: 404, headers: noStore });
    return new NextResponse(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(png.length),
        "Cache-Control": PUBLIC_CACHE,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404, headers: noStore });
  }
}

async function readCapped(req: NextRequest): Promise<Buffer | "too_large"> {
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_INPUT_BYTES) return "too_large";
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_INPUT_BYTES) {
      await reader.cancel().catch(() => undefined);
      return "too_large";
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function handlePostAccountIcon(req: NextRequest): Promise<Response> {
  if (IS_DEMO) return NextResponse.json({ error: "demo" }, { status: 403, headers: noStore });
  // This path bypasses the proxy body-clone middleware so the owner can send an
  // 8 MiB image without being buffered twice. That means the two guards the proxy
  // would have applied on this path are repeated here, exactly as /fs/upload does.
  const host = req.headers.get("host") ?? new URL(req.url).host;
  if (managedAppIdForHost(host) || isUnclaimedAppNamespaceHost(host))
    return new NextResponse("Not Found", { status: 404 });
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none")
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403, headers: noStore });
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== host)
        return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403, headers: noStore });
    } catch {
      return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403, headers: noStore });
    }
  }
  const context = await getSessionContext();
  if (!context || context.role !== "owner") {
    return NextResponse.json({ error: "owner_required" }, { status: 403, headers: noStore });
  }
  const body = await readCapped(req);
  if (body === "too_large") {
    return NextResponse.json({ error: "too_large" }, { status: 413, headers: noStore });
  }
  try {
    const converted = await convertAccountIcon(body, req.headers.get("content-type") ?? "");
    const src = `data:image/webp;base64,${converted.webp.toString("base64")}`;
    const profile = await writeAccountProfile({ icon: { type: "image", src } });
    await audit({ action: "auth.account", actor: context.session.device_id, ok: true, detail: "icon:upload" });
    return NextResponse.json(profile, { headers: noStore });
  } catch (error) {
    if (error instanceof AccountIconError) {
      const status = error.code === "too_large" ? 413 : error.code === "unsupported_type" ? 415 : 422;
      return NextResponse.json({ error: error.code }, { status, headers: noStore });
    }
    if (error instanceof AccountProfileError) {
      return NextResponse.json({ error: error.code }, { status: error.code === "corrupt" ? 500 : 400, headers: noStore });
    }
    return NextResponse.json({ error: "invalid" }, { status: 400, headers: noStore });
  }
}
