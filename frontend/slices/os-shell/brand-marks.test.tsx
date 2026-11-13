import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { ActiveShellProvider, type ShellId } from "@/features/appshell";
import { APP_MARKS } from "./brand-marks";

function markup(id: string, shell?: { id: ShellId; surface?: "desktop" | "mobile" }) {
  const Icon = APP_MARKS[id];
  if (!Icon) throw new Error(`missing app mark ${id}`);
  if (shell) {
    return renderToStaticMarkup(
      <ActiveShellProvider id={shell.id} surface={shell.surface ?? "desktop"}>
        <Icon className="size-full" />
      </ActiveShellProvider>,
    );
  }
  return renderToStaticMarkup(<Icon className="size-full" />);
}

describe("third-party official app marks", () => {
  it.each([
    ["camoufox-browser", "/brand/official/camoufox.webp"],
    ["hermes", "/brand/official/hermes.webp"],
    ["openclaw", "/brand/official/openclaw.webp"],
    ["9router", "/brand/official/9router.webp"],
    ["n8n", "/brand/official/n8n.webp"],
    ["orca", "/brand/official/orca.webp"],
    ["dokploy", "/brand/official/dokploy.webp"],
    ["cloudflare", "/brand/official/cloudflare.webp"],
  ])("keeps %s shell-invariant and official", (id, src) => {
    const html = markup(id);
    expect(html).toContain(`src="${src}"`);
    expect(html).not.toContain("shell-artwork-macos");
    expect(html).not.toContain("shell-artwork-windows");
    expect((html.match(/<img\b/g) ?? []).length).toBe(1);
  });
  it.each(["openclaw", "orca", "dokploy", "cloudflare", "composio", "doku"])("ships %s artwork as a 192px alpha lossless WebP tile", async (name) => {
    const metadata = await sharp(`public/brand/official/${name}.webp`).metadata();
    expect(metadata.format).toBe("webp");
    expect(metadata.width).toBe(192);
    expect(metadata.height).toBe(192);
    expect(metadata.hasAlpha).toBe(true);
    const webp = readFileSync(`public/brand/official/${name}.webp`);
    expect(webp.toString("ascii", 12, 16)).toBe("VP8L");
  });

  it("preserves OpenClaw's official pixel-lobster pixels exactly", async () => {
    const expected = await sharp("public/brand/official/openclaw.svg")
      .resize(192, 192, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .raw()
      .toBuffer();
    const actual = await sharp("public/brand/official/openclaw.webp").raw().toBuffer();
    expect(actual).toEqual(expected);
  });

  it("uses a dark neutral tile behind monochrome Dokploy and Cloudflare marks", () => {
    expect(markup("dokploy")).toContain("background:#111827");
    expect(markup("cloudflare")).toContain("background:#111827");
    expect(markup("openclaw")).toContain("background:#f5fbff");
    expect(markup("openclaw")).toContain("rounded-[var(--radius-icon)]");
  });
});

describe("first-party platform app artwork", () => {
  it("defaults to macOS artwork outside a provider (isolated tests)", () => {
    const html = markup("files-manager");
    expect((html.match(/<img\b/g) ?? []).length).toBe(1);
    expect(html).toContain("/app-icons/macos/files.webp");
    expect(html).toContain("shell-artwork-macos");
    expect(html).not.toContain("/app-icons/windows/files.webp");
    expect(html).not.toContain("/app-icons/files.webp");
  });

  it("renders macOS artwork for macOS shell", () => {
    const html = markup("files-manager", { id: "macos" });
    expect((html.match(/<img\b/g) ?? []).length).toBe(1);
    expect(html).toContain("/app-icons/macos/files.webp");
    expect(html).toContain("shell-artwork-macos");
    expect(html).not.toContain("/app-icons/windows/files.webp");
  });

  it("reuses macOS artwork family for iOS shell", () => {
    const html = markup("files-manager", { id: "ios", surface: "mobile" });
    expect((html.match(/<img\b/g) ?? []).length).toBe(1);
    expect(html).toContain("/app-icons/macos/files.webp");
    expect(html).toContain("shell-artwork-macos");
    expect(html).not.toContain("/app-icons/windows/files.webp");
    expect(html).not.toContain("/app-icons/files.webp");
  });

  it("renders Windows artwork for Windows shell", () => {
    const html = markup("files-manager", { id: "windows" });
    expect((html.match(/<img\b/g) ?? []).length).toBe(1);
    expect(html).toContain("/app-icons/windows/files.webp");
    expect(html).toContain("shell-artwork-windows");
    expect(html).not.toContain("/app-icons/macos/files.webp");
  });

  it("reuses Windows artwork family for Android shell", () => {
    const html = markup("files-manager", { id: "android", surface: "mobile" });
    expect((html.match(/<img\b/g) ?? []).length).toBe(1);
    expect(html).toContain("/app-icons/windows/files.webp");
    expect(html).toContain("shell-artwork-windows");
    expect(html).not.toContain("/app-icons/macos/files.webp");
    expect(html).not.toContain("/app-icons/files.webp");
  });

  it("falls back to default artwork for dashboard shell", () => {
    const html = markup("files-manager", { id: "dashboard" });
    expect((html.match(/<img\b/g) ?? []).length).toBe(1);
    expect(html).toContain("/app-icons/files.webp");
    expect(html).toContain("shell-artwork-default");
    expect(html).not.toContain("/app-icons/macos/files.webp");
    expect(html).not.toContain("/app-icons/windows/files.webp");
  });

  it("falls back to default artwork for unknown shell", () => {
    const html = markup("files-manager", { id: "unknown" as ShellId });
    expect((html.match(/<img\b/g) ?? []).length).toBe(1);
    expect(html).toContain("/app-icons/files.webp");
    expect(html).toContain("shell-artwork-default");
    expect(html).not.toContain("/app-icons/macos/files.webp");
    expect(html).not.toContain("/app-icons/windows/files.webp");
  });
});
