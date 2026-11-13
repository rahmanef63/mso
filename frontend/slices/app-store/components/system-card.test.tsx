import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SYSTEM_CATALOG } from "../lib/system-catalog";
import { SystemCard } from "./system-card";

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
});
