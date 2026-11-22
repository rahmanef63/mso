// Pure, dependency-free image-dimension probe — reads just the header bytes of
// PNG / JPEG / GIF / WebP so the headless route can size a doc from an `open`ed
// image WITHOUT decoding it (no native canvas). The real pixels render later in
// the actual editor; dimensions are only needed to seed the layer transform.
// Falls back to a square default for unknown formats.
const DEFAULT = { width: 1080, height: 1080 };

function toBuffer(src: string): Buffer {
  const m = /^data:[^;]+;base64,(.*)$/s.exec(src);
  return Buffer.from(m ? m[1] : src, m ? "base64" : "binary");
}

// Accepts a data URL / raw string OR a header Buffer (the route reads the file's
// first bytes off disk so the doc can store a path-URL src, not fat base64).
// `fallback:true` = format not recognised → DEFAULT used (caller should warn).
export function imageSize(src: string | Buffer): { width: number; height: number; fallback?: boolean } {
  let b: Buffer;
  try {
    b = Buffer.isBuffer(src) ? src : toBuffer(src);
  } catch {
    return { ...DEFAULT, fallback: true };
  }
  // BMP: "BM" → int32-LE width @18, height @22 (height may be negative = top-down).
  if (b.length >= 26 && b[0] === 0x42 && b[1] === 0x4d) {
    return { width: b.readInt32LE(18), height: Math.abs(b.readInt32LE(22)) };
  }
  // PNG: 8-byte sig, then IHDR — width/height as big-endian u32 at 16/20.
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50) {
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  // GIF: "GIF8…" → little-endian u16 width/height at offset 6/8.
  if (b.length >= 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  }
  // WebP: "RIFF"…"WEBP" then a VP8/VP8L/VP8X chunk.
  if (b.length >= 30 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const fmt = b.toString("ascii", 12, 16);
    if (fmt === "VP8X") return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    if (fmt === "VP8 ") return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (fmt === "VP8L" && b[20] === 0x2f) {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }
  // JPEG: scan SOF0–SOF3 markers (0xFFC0–C3) for the frame height/width.
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) { o++; continue; }
      const marker = b[o + 1];
      if (marker >= 0xc0 && marker <= 0xc3) return { height: b.readUInt16BE(o + 5), width: b.readUInt16BE(o + 7) };
      o += 2 + b.readUInt16BE(o + 2);
    }
  }
  return { ...DEFAULT, fallback: true }; // unknown (AVIF/HEIC/TIFF/…) — caller warns
}
