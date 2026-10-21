import { NextResponse } from "next/server";
import { readAccountProfile } from "@/lib/auth/account-profile";
import { accountIconPng } from "@/lib/auth/account-icon-image";

// Dynamic favicon + PWA icons. This replaces the static app/icon.svg so the
// owner's uploaded art reaches the browser tab.
//
// Public on purpose: a favicon is fetched by an unauthenticated tab, long before
// any session exists. It reads only the stored icon bytes (never the name).
//
// `force-dynamic` is required — without it Next bakes the build-time profile into
// the route and a later upload would never show. A short max-age keeps the
// per-page-load cost down instead; stale-while-revalidate hides the re-render.

export const dynamic = "force-dynamic";

const SIZES = [32, 192, 512] as const;
const CACHE = "public, max-age=60, stale-while-revalidate=300";

export function generateImageMetadata() {
  return SIZES.map((size) => ({
    id: String(size),
    size: { width: size, height: size },
    contentType: "image/png",
  }));
}

export default async function Icon({ id }: { id: Promise<string | number> }) {
  const requested = Number.parseInt(String(await id), 10);
  const size = (SIZES as readonly number[]).includes(requested) ? requested : 32;
  let png: Buffer;
  try {
    png = await accountIconPng((await readAccountProfile()).icon, size);
  } catch {
    png = Buffer.alloc(0);
  }
  if (!png.length) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(png.length),
      "Cache-Control": CACHE,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
