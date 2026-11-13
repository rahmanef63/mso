import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppMark, MANAGED_APP_META } from "./app-meta";

describe("managed-app official artwork", () => {
  it.each([
    ["hermes", "/brand/official/hermes.webp"],
    ["openclaw", "/brand/official/openclaw.webp"],
    ["9router", "/brand/official/9router.webp"],
    ["orca", "/brand/official/orca.webp"],
  ] as const)("renders the official %s mark in its management card", (id, src) => {
    expect(MANAGED_APP_META[id].artwork).toBe(src);
    const html = renderToStaticMarkup(<AppMark id={id} className="size-5" />);
    expect(html).toContain(`src="${src}"`);
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("<svg");
    if (id === "openclaw") expect(html).toContain("background:#f5fbff");
  });
});
