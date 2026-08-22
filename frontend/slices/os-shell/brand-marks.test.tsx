import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { APP_MARKS } from "./brand-marks";

function markup(id: string) {
  const Icon = APP_MARKS[id];
  if (!Icon) throw new Error(`missing app mark ${id}`);
  return renderToStaticMarkup(<Icon className="size-full" />);
}

describe("third-party official app marks", () => {
  it.each([
    ["camoufox-browser", "/brand/official/camoufox.webp"],
    ["hermes", "/brand/official/hermes.webp"],
    ["openclaw", "/brand/official/openclaw.webp"],
  ])("keeps %s shell-invariant and official", (id, src) => {
    const html = markup(id);
    expect(html).toContain(`src="${src}"`);
    expect(html).not.toContain("shell-artwork-macos");
    expect(html).not.toContain("shell-artwork-windows");
  });

  it("keeps first-party app artwork platform-aware", () => {
    const html = markup("files-manager");
    expect(html).toContain("/app-icons/macos/files.webp");
    expect(html).toContain("/app-icons/windows/files.webp");
    expect(html).toContain("shell-artwork-macos");
    expect(html).toContain("shell-artwork-windows");
  });
});
