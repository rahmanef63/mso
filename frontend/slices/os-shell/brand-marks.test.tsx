import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
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
  ])("keeps %s shell-invariant and official", (id, src) => {
    const html = markup(id);
    expect(html).toContain(`src="${src}"`);
    expect(html).not.toContain("shell-artwork-macos");
    expect(html).not.toContain("shell-artwork-windows");
    expect((html.match(/<img\b/g) ?? []).length).toBe(1);
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
