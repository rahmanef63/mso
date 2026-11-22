import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SYSTEM_CATALOG } from "../lib/system-catalog";
import { SystemCard } from "./system-card";

// SystemCard is a thin wrapper over StoreTile; the row chrome and the shared
// states live in store-tile.test.tsx. What is worth pinning here is the one
// thing only the system rows do: official artwork instead of a Lucide glyph.
describe("system app official artwork", () => {
  it.each([
    ["dokploy", "/brand/official/dokploy.webp"],
    ["cloudflare", "/brand/official/cloudflare.webp"],
  ] as const)("renders the official %s mark", (id, src) => {
    const entry = SYSTEM_CATALOG.find((candidate) => candidate.id === id);
    if (!entry) throw new Error(`missing system catalog entry ${id}`);
    const html = renderToStaticMarkup(
      <SystemCard entry={entry} installed onToggle={() => undefined} />,
    );
    expect(html).toContain(`src="${src}"`);
    expect(html).toContain('aria-hidden="true"');
  });

  it("falls back to the Lucide glyph when there is no artwork", () => {
    const entry = SYSTEM_CATALOG.find((candidate) => candidate.id === "files-manager");
    if (!entry) throw new Error("missing system catalog entry files-manager");
    const html = renderToStaticMarkup(
      <SystemCard entry={entry} installed onToggle={() => undefined} />,
    );
    expect(html).toContain("<svg");
    expect(html).not.toContain("object-contain");
  });
});
