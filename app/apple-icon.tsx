import { NextResponse } from "next/server";
import { readAccountProfile } from "@/lib/auth/account-profile";
import { accountIconPng } from "@/lib/auth/account-icon-image";

// Apple touch icon (iOS home screen). iOS masks its own corners, so the owner's
// square art works as-is; the brand fallback keeps the current full-bleed mark.
// Dynamic for the same reason as app/icon.tsx: the upload must reach it.

export const dynamic = "force-dynamic";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

const CACHE = "public, max-age=60, stale-while-revalidate=300";

export default async function AppleIcon() {
  let png: Buffer;
  try {
    png = await accountIconPng((await readAccountProfile()).icon, size.width);
  } catch {
    png = Buffer.alloc(0);
  }
  if (!png.length) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(png), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(png.length),
      "Cache-Control": CACHE,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
