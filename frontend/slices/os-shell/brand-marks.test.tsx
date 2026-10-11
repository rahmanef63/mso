import { statSync } from "node:fs";
import sharp from "sharp";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActiveShellProvider, type ShellId } from "@/features/appshell";
import { APP_MARKS } from "./brand-marks";

function markup(id: string, shell: ShellId = "macos") {
  const Icon = APP_MARKS[id];
  if (!Icon) throw new Error(`missing app mark ${id}`);
  return renderToStaticMarkup(<ActiveShellProvider id={shell} surface={shell === "ios" || shell === "android" ? "mobile" : "desktop"}><Icon className="size-full" /></ActiveShellProvider>);
}

describe("third-party official app marks", () => {
  it.each([
    ["camoufox-browser", "/brand/official/camoufox.webp"],
    ["hermes", "/brand/official/hermes.webp"],
    ["n8n", "/brand/official/n8n.svg"],
    ["openclaw", "/brand/official/openclaw.webp"],
    ["9router", "/brand/official/9router.webp"],
  ])("keeps %s shell-invariant and official", (id, src) => {
    const html = markup(id);
    expect(html).toContain(`src="${src}"`);
    expect(html).toContain('fetchPriority="low"');
    expect(html).not.toContain("shell-artwork-macos");
    expect(html).not.toContain("shell-artwork-windows");
    expect(html).not.toContain("srcSet=");
    expect(html).not.toContain("loading=");
  });

  it.each([
    ["macos", "/app-icons/macos/files.webp"],
    ["ios", "/app-icons/macos/files.webp"],
    ["windows", "/app-icons/windows/files.webp"],
    ["android", "/app-icons/windows/files.webp"],
    ["dashboard", "/app-icons/files.webp"],
  ] as const)("renders only the active %s artwork", (shell, src) => {
    const html = markup("files-manager", shell);
    expect(html.match(/<img\b/g)).toHaveLength(1);
    const width = shell === "dashboard" ? 192 : 256;
    expect(html).toContain(`srcSet="${src.replace(".webp", "-128.webp")} 128w, ${src} ${width}w"`);
    expect(html).toContain(`width="${width}" height="${width}" loading="lazy"`);
    expect(html).toContain('sizes="auto, 256px"');
    expect(html).toContain(`<source media="(resolution &gt; 2dppx)" srcSet="${src}"/>`);
    if (width === 256) expect(html).toContain(`<source media="(resolution &gt; 2dppx)" type="image/avif" srcSet="${src.replace(".webp", ".avif")}"/>`);
    else expect(html).not.toContain('type="image/avif"');
    expect(html).toContain(`src="${src}"`);
    expect(html).toContain('fetchPriority="low"');
    for (const other of ["/app-icons/macos/files.webp", "/app-icons/windows/files.webp", "/app-icons/files.webp"].filter(path => path !== src)) expect(html).not.toContain(other);
  });
});

it("includes smaller WebP companions for every public platform artwork", async () => {
  const sources = new Set<string>();
  for (const shell of ["macos", "windows", "dashboard"] as const) for (const id of Object.keys(APP_MARKS)) {
    const src = markup(id, shell).match(/<img[^>]*\bsrc="([^"]+)"/)?.[1];
    if (src?.startsWith("/app-icons/")) sources.add(src);
  }
  expect(sources.size).toBe(42);
  for (const src of sources) {
    const full = `public${src}`, small = full.replace(".webp", "-128.webp");
    expect(statSync(small).size).toBeLessThan(statSync(full).size);
    const original = await sharp(full).metadata();
    const width = src.startsWith("/app-icons/macos/") || src.startsWith("/app-icons/windows/") ? 256 : 192;
    expect([original.width, original.height]).toEqual([width, width]);
    const metadata = await sharp(small).metadata();
    expect([metadata.format, metadata.width, metadata.height]).toEqual(["webp", 128, 128]);
    if (width === 256) {
      const avif = full.replace(".webp", ".avif");
      expect(statSync(avif).size).toBeLessThan(statSync(full).size);
      const info = await sharp(avif).metadata();
      expect([info.compression, info.width, info.height]).toEqual(["av1", 256, 256]);
    }
  }
});
