import sharp from "sharp";
import type { AccountIcon } from "./account-profile-model";

// Server-side icon pipeline: one decode, then every size the app needs. The
// browser never decides what is stored — it uploads raw bytes, this module
// normalises and re-encodes them. Metadata (EXIF/GPS/ICC) is dropped because no
// output below calls `withMetadata()`.
//
// sharp cannot write ICO (its output formats stop at png/webp/jpeg/avif/tiff/gif
// on this host), so `buildIco` writes the 6-byte ICONDIR + N×16-byte entries by
// hand and embeds PNG payloads. That is the whole format browsers need.

export const MAX_INPUT_BYTES = 8 * 1024 * 1024;
/** Decoded-area cap checked BEFORE any resize: a 40 MP image is already 160 MB
 *  of RGBA, so anything larger is a decompression bomb, not a phone photo. */
export const MAX_PIXELS = 40_000_000;
/** Headroom under account-profile.ts `imageIcon()` (32_000 decoded bytes). */
const STORED_WEBP_BUDGET = 28_000;
const ICON_WEBP_SIZE = 256;
const ICON_BACKGROUND = "#0a0a0a";
const ICO_SIZES = [16, 32, 48] as const;

const ACCEPTED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/heic",
  "image/heif",
  "image/svg+xml",
]);

export type ConvertedIcon = {
  webp: Buffer;
  png192: Buffer;
  png512: Buffer;
  apple180: Buffer;
  ico: Buffer;
};

export class AccountIconError extends Error {
  constructor(
    readonly code:
      | "too_large"
      | "too_many_pixels"
      | "unsupported_type"
      | "invalid_image"
      | "webp_too_large",
  ) {
    super(code);
    this.name = "AccountIconError";
  }
}

/** `limitInputPixels` is enforced by libvips during decode, so a bomb fails
 *  before the pixel buffer is allocated. */
function load(bytes: Buffer) {
  return sharp(bytes, { limitInputPixels: MAX_PIXELS, animated: false, failOn: "error" }).rotate();
}

/** Header-only probe. `limitInputPixels: false` is safe here because metadata()
 *  reads dimensions without allocating the pixel buffer; the area check below
 *  then decides whether a full decode is allowed. Decoding always goes through
 *  `load()`, which re-imposes the limit, so a lying header cannot get past it. */
function probe(bytes: Buffer) {
  return sharp(bytes, { limitInputPixels: false, animated: false, failOn: "error" });
}

function square(input: Buffer, size: number) {
  return load(input)
    .flatten({ background: ICON_BACKGROUND })
    .resize(size, size, { fit: "cover", position: "centre" });
}

async function squarePng(input: Buffer, size: number): Promise<Buffer> {
  return square(input, size).png({ compressionLevel: 9 }).toBuffer();
}

async function squareWebp(input: Buffer): Promise<Buffer> {
  // Photos at q82 land around 10–20 KB; step down only when a noisy image would
  // otherwise break the stored cap. Never truncate — re-encode or reject.
  for (const quality of [82, 72, 62, 52, 40]) {
    const out = await square(input, ICON_WEBP_SIZE).webp({ quality, effort: 4 }).toBuffer();
    if (out.length <= STORED_WEBP_BUDGET) return out;
  }
  throw new AccountIconError("webp_too_large");
}

/** ICONDIR + ICONDIRENTRY table, then the PNG payloads back to back. Width and
 *  height are one byte each, with 256 encoded as 0. */
export function buildIco(images: readonly { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((image, index) => {
    const entry = 6 + 16 * index;
    const edge = image.size >= 256 ? 0 : image.size;
    header.writeUInt8(edge, entry);
    header.writeUInt8(edge, entry + 1);
    header.writeUInt8(0, entry + 2); // palette size
    header.writeUInt8(0, entry + 3); // reserved
    header.writeUInt16LE(1, entry + 4); // colour planes
    header.writeUInt16LE(32, entry + 6); // bits per pixel
    header.writeUInt32LE(image.png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.png.length;
  });
  return Buffer.concat([header, ...images.map((image) => image.png)]);
}

/** Convert raw upload bytes into every stored/served form. Throws
 *  `AccountIconError` for anything the trust boundary refuses. */
export async function convertAccountIcon(input: Buffer, mime: string): Promise<ConvertedIcon> {
  if (input.length === 0) throw new AccountIconError("invalid_image");
  if (input.length > MAX_INPUT_BYTES) throw new AccountIconError("too_large");
  if (!ACCEPTED_MIME.has(mime.split(";")[0]!.trim().toLowerCase())) {
    throw new AccountIconError("unsupported_type");
  }
  let width = 0;
  let height = 0;
  try {
    const meta = await probe(input).metadata();
    width = meta.width ?? 0;
    height = meta.height ?? 0;
  } catch {
    throw new AccountIconError("invalid_image");
  }
  // SVG without intrinsic width/height is refused: there is nothing to bound.
  if (width < 1 || height < 1) throw new AccountIconError("invalid_image");
  if (width * height > MAX_PIXELS) throw new AccountIconError("too_many_pixels");

  const [webp, png192, png512, apple180, ...icoPngs] = await Promise.all([
    squareWebp(input),
    squarePng(input, 192),
    squarePng(input, 512),
    squarePng(input, 180),
    ...ICO_SIZES.map((size) => squarePng(input, size)),
  ]);
  return {
    webp,
    png192,
    png512,
    apple180,
    ico: buildIco(ICO_SIZES.map((size, index) => ({ size, png: icoPngs[index]! }))),
  };
}

const DATA_URL = /^data:image\/[a-z+]+;base64,([A-Za-z0-9+/]+={0,2})$/;

function storedBytes(icon: AccountIcon): Buffer | null {
  if (icon.type !== "image") return null;
  const match = DATA_URL.exec(icon.src);
  return match?.[1] ? Buffer.from(match[1], "base64") : null;
}

/** Brand art fallback, inlined on purpose. Reading `public/icon.svg` at request time
 *  with `fs.readFile(path.join(process.cwd(), …))` made Turbopack trace the whole
 *  project as a dynamic filesystem dependency ("Dynamic filesystem access causes
 *  tracing of the whole project"), which the release gate treats as a build warning
 *  and therefore a failure. The mark is a fixed glyph, so it belongs in the bundle. */
const BRAND_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="b" x1="48" y1="40" x2="466" y2="474" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#4a7cf8"/><stop offset="1" stop-color="#6a54f8"/></linearGradient></defs><rect width="512" height="512" rx="116" fill="url(#b)"/><g fill="none" stroke="#ffffff" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"><path d="M138 150 L238 150 L292 179 L374 179 Q402 179 402 207 L402 370 Q402 398 374 398 L138 398 Q110 398 110 370 L110 178 Q110 150 138 150 Z"/><path d="M166 272 L204 302 L166 332"/><path d="M226 348 L286 348"/><path d="M320 272 L358 302 L320 332"/></g><g fill="#ffffff"><circle cx="150" cy="188" r="11"/><circle cx="186" cy="188" r="11"/><circle cx="222" cy="188" r="11"/></g></svg>`;

export async function brandPng(size: number): Promise<Buffer> {
  return load(Buffer.from(BRAND_SVG))
    .flatten({ background: ICON_BACKGROUND })
    .resize(size, size, { fit: "contain", position: "centre" })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** Square PNG for a public icon route: the owner's image when one is stored,
 *  the brand mark otherwise. Never throws: a corrupt stored icon must not take
 *  the favicon down with it. */
export async function accountIconPng(icon: AccountIcon, size: number): Promise<Buffer> {
  const bytes = storedBytes(icon);
  if (bytes) {
    try {
      return await squarePng(bytes, size);
    } catch {
      // Fall through to the brand mark.
    }
  }
  try {
    return await brandPng(size);
  } catch {
    return Buffer.alloc(0);
  }
}
