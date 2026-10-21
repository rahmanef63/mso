import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  AccountIconError,
  buildIco,
  convertAccountIcon,
  MAX_INPUT_BYTES,
  MAX_PIXELS,
} from "./account-icon-image";

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function photoWithExif(): Promise<Buffer> {
  return sharp({ create: { width: 300, height: 200, channels: 3, background: "#3a7bd5" } })
    .jpeg({ quality: 90 })
    .withMetadata({
      exif: {
        IFD0: { ImageDescription: "MSO-TEST-EXIF", Make: "MSO", Model: "TestCam" },
        IFD3: { GPSLatitudeRef: "S", GPSLatitude: "1/1 2/1 3/1" },
      },
    })
    .toBuffer();
}

describe("convertAccountIcon", () => {
  it("strips EXIF/GPS and returns WebP by magic", async () => {
    const input = await photoWithExif();
    expect((await sharp(input).metadata()).exif).toBeTruthy();

    const out = await convertAccountIcon(input, "image/jpeg");
    const meta = await sharp(out.webp).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(256);
    expect(meta.height).toBe(256);
    // No EXIF, GPS, or ICC profile survives the re-encode.
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(out.webp.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(out.webp.subarray(8, 12).toString("ascii")).toBe("WEBP");
    expect(out.webp.length).toBeLessThanOrEqual(28_000);
    expect(out.webp.includes(Buffer.from("EXIF"))).toBe(false);
    expect(out.webp.includes(Buffer.from("GPS"))).toBe(false);
    expect(out.webp.includes(Buffer.from("MSO-TEST-EXIF"))).toBe(false);
    expect(out.webp.includes(Buffer.from("TestCam"))).toBe(false);
  });

  it("emits square PNGs for the manifest and Apple touch icon", async () => {
    const out = await convertAccountIcon(await photoWithExif(), "image/jpeg");
    for (const [buffer, size] of [[out.png192, 192], [out.png512, 512], [out.apple180, 180]] as const) {
      expect(buffer.subarray(0, 8).equals(PNG_SIG)).toBe(true);
      const meta = await sharp(buffer).metadata();
      expect(meta.format).toBe("png");
      expect([meta.width, meta.height]).toEqual([size, size]);
    }
  });

  it("builds an ICO whose directory offsets tile the PNG payloads exactly", async () => {
    const out = await convertAccountIcon(await photoWithExif(), "image/jpeg");
    const ico = out.ico;
    expect(ico.readUInt16LE(0)).toBe(0); // reserved
    expect(ico.readUInt16LE(2)).toBe(1); // type = icon
    const count = ico.readUInt16LE(4);
    expect(count).toBe(3);

    let expectedOffset = 6 + 16 * count;
    const sizes: number[] = [];
    for (let index = 0; index < count; index++) {
      const entry = 6 + 16 * index;
      const width = ico.readUInt8(entry);
      const height = ico.readUInt8(entry + 1);
      expect(width).toBe(height);
      sizes.push(width === 0 ? 256 : width);
      expect(ico.readUInt8(entry + 2)).toBe(0); // palette
      expect(ico.readUInt8(entry + 3)).toBe(0); // reserved
      expect(ico.readUInt16LE(entry + 4)).toBe(1); // planes
      expect(ico.readUInt16LE(entry + 6)).toBe(32); // bpp

      const length = ico.readUInt32LE(entry + 8);
      const offset = ico.readUInt32LE(entry + 12);
      // Every entry starts exactly where the previous payload ended…
      expect(offset).toBe(expectedOffset);
      // …lands on a real PNG signature…
      expect(ico.subarray(offset, offset + 8).equals(PNG_SIG)).toBe(true);
      // …and covers a complete PNG of that size.
      const payload = ico.subarray(offset, offset + length);
      expect(payload.length).toBe(length);
      const meta = await sharp(payload).metadata();
      expect(meta.format).toBe("png");
      expect([meta.width, meta.height]).toEqual([sizes[index], sizes[index]]);
      expectedOffset += length;
    }
    // No gaps and nothing after the last payload.
    expect(expectedOffset).toBe(ico.length);
    expect(sizes).toEqual([16, 32, 48]);
  });

  it("rejects oversize input rather than truncating it", async () => {
    const oversize = Buffer.alloc(MAX_INPUT_BYTES + 1, 0x41);
    await expect(convertAccountIcon(oversize, "image/png")).rejects.toMatchObject({ code: "too_large" });
    await expect(convertAccountIcon(oversize, "image/png")).rejects.toBeInstanceOf(AccountIconError);
  });

  it("rejects a decompression bomb by decoded area before decoding", async () => {
    // 9000×5000 = 45 MP: small as a JPEG, far too large once decoded.
    const bomb = await sharp({ create: { width: 9000, height: 5000, channels: 3, background: "#101010" } })
      .jpeg({ quality: 40 })
      .toBuffer();
    expect(bomb.length).toBeLessThan(MAX_INPUT_BYTES);
    expect(9000 * 5000).toBeGreaterThan(MAX_PIXELS);
    await expect(convertAccountIcon(bomb, "image/jpeg")).rejects.toMatchObject({ code: "too_many_pixels" });
  });

  it("rejects a declared type it cannot decode and non-image bytes", async () => {
    await expect(convertAccountIcon(Buffer.from("hello"), "text/plain")).rejects.toMatchObject({ code: "unsupported_type" });
    await expect(convertAccountIcon(Buffer.from("not an image"), "image/png")).rejects.toMatchObject({ code: "invalid_image" });
    await expect(convertAccountIcon(Buffer.alloc(0), "image/png")).rejects.toMatchObject({ code: "invalid_image" });
  });

  it("rasterises SVG and flattens alpha onto a square background", async () => {
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="30" fill="#ffffff"/></svg>`,
    );
    const out = await convertAccountIcon(svg, "image/svg+xml");
    const meta = await sharp(out.webp).metadata();
    expect([meta.width, meta.height]).toEqual([256, 256]);
    expect(meta.hasAlpha).toBe(false);
  });

  it("writes an ICO directory with the documented header layout", () => {
    const ico = buildIco([{ size: 16, png: Buffer.from([1, 2, 3]) }]);
    expect(ico.length).toBe(6 + 16 + 3);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(1);
    expect(ico.readUInt32LE(6 + 8)).toBe(3);
    expect(ico.readUInt32LE(6 + 12)).toBe(22);
    expect(ico.readUInt8(6)).toBe(16);
  });
});
