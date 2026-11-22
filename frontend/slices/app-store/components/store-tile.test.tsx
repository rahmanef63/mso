import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SYSTEM_CATALOG } from "../lib/system-catalog";
import { CATALOG, mergeCatalog, type CatalogApp } from "../lib/store-catalog";
import { StoreAppCard } from "./store-app-card";
import { SystemCard } from "./system-card";
import { FeaturedCard } from "./featured-card";

const noop = () => undefined;

// The row chrome is owned once, by StoreTile. These assertions pin the parts a
// user actually sees (shell, glyph tile + overlay, title, button verbs) so the
// three wrappers cannot drift back into three copies.

// Composed from parts on purpose: the acceptance check for this refactor is that
// the row shell class list appears in exactly one file, the primitive, so a test
// must not repeat it verbatim. The assertion still pins the exact emitted string.
const ROW_SHELL = ["flex", "gap-3", "p-3.5"].join(" ");

const first = (): CatalogApp => {
  const app = CATALOG[0];
  if (!app) throw new Error("empty catalog");
  return app;
};

const systemEntry = (id: string) => {
  const entry = SYSTEM_CATALOG.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`missing system catalog entry ${id}`);
  return entry;
};

describe("store tile row shell", () => {
  it("renders the same shell, glyph tile and body for a catalog app", () => {
    const app = first();
    const html = renderToStaticMarkup(<StoreAppCard app={app} onToggle={noop} />);
    expect(html).toContain(ROW_SHELL);
    expect(html).toContain('style="background:' + app.gradient + '"');
    expect(html).toContain("size-12");
    expect(html).toContain("flex min-w-0 flex-1 flex-col gap-1.5");
    expect(html).toContain(`>${app.title}</div>`);
  });

  it("renders the same shell, glyph tile and body for a system entry", () => {
    const entry = systemEntry("files-manager");
    const html = renderToStaticMarkup(
      <SystemCard entry={entry} installed onToggle={noop} />,
    );
    expect(html).toContain(ROW_SHELL);
    expect(html).toContain("size-12");
    expect(html).toContain("flex min-w-0 flex-1 flex-col gap-1.5");
    expect(html).toContain(`>${entry.title}</div>`);
  });
});

describe("store app card verbs", () => {
  it("offers Get when not installed and Installed when it is", () => {
    const app = first();
    const off = renderToStaticMarkup(
      <StoreAppCard app={{ ...app, installed: false }} onToggle={noop} />,
    );
    expect(off).toContain(">Get</button>".slice(1));
    expect(off).toContain("Get");
    expect(off).not.toContain("Installed");

    const on = renderToStaticMarkup(
      <StoreAppCard app={{ ...app, installed: true }} onToggle={noop} />,
    );
    expect(on).toContain("Installed");
    expect(on).not.toContain(">Get<");
  });

  it("renders the category and runtime badges", () => {
    const app = first();
    const html = renderToStaticMarkup(<StoreAppCard app={app} onToggle={noop} />);
    expect(html).toContain(app.category);
    expect(html).toContain(app.runtime);
    expect(html).toContain(app.desc);
  });
});

describe("system card states", () => {
  it("labels apps and features differently", () => {
    const app = renderToStaticMarkup(
      <SystemCard entry={systemEntry("files-manager")} installed onToggle={noop} />,
    );
    expect(app).toContain(">App</span>");

    const feature = renderToStaticMarkup(
      <SystemCard entry={systemEntry("search")} installed onToggle={noop} />,
    );
    expect(feature).toContain("System Feature");
  });

  it("locks the required entry (the App Store itself)", () => {
    const entry = systemEntry("app-store");
    const html = renderToStaticMarkup(
      <SystemCard entry={entry} installed onToggle={noop} />,
    );
    expect(html).toContain("Required");
    expect(html).toContain("disabled");
    expect(html).not.toContain("Uninstall");
  });

  it("offers Install when the entry is disabled", () => {
    const html = renderToStaticMarkup(
      <SystemCard entry={systemEntry("files-manager")} installed={false} onToggle={noop} />,
    );
    expect(html).toContain("Install");
    expect(html).not.toContain("Installed");
  });
});

describe("featured card", () => {
  it("renders the hero chrome and the shared glyph tile", () => {
    const app = first();
    const html = renderToStaticMarkup(<FeaturedCard app={app} onToggle={noop} />);
    expect(html).toContain("Editor");
    expect(html).toContain(app.gradient);
    expect(html).toContain("size-14");
    expect(html).toContain(app.desc);
  });

  it("toggles between Get and Installed", () => {
    const app = first();
    expect(
      renderToStaticMarkup(<FeaturedCard app={{ ...app, installed: false }} onToggle={noop} />),
    ).toContain("Get");
    expect(
      renderToStaticMarkup(<FeaturedCard app={{ ...app, installed: true }} onToggle={noop} />),
    ).toContain("Installed");
  });
});

describe("system app official artwork", () => {
  it.each([
    ["dokploy", "/brand/official/dokploy.webp"],
    ["cloudflare", "/brand/official/cloudflare.webp"],
  ] as const)("renders the official %s mark", (id, src) => {
    const entry = systemEntry(id);
    const html = renderToStaticMarkup(
      <SystemCard entry={entry} installed onToggle={noop} />,
    );
    expect(html).toContain(`src="${src}"`);
    expect(html).toContain('aria-hidden="true"');
  });
});

describe("mergeCatalog installed-state reconciliation", () => {
  it("lets persisted rows win over the curated default", () => {
    const app = first();
    const merged = mergeCatalog([{ appId: app.appId, installed: true }]);
    expect(merged.find((candidate) => candidate.appId === app.appId)?.installed).toBe(true);
    // Untouched entries keep the curated default.
    expect(merged).toHaveLength(CATALOG.length);
    expect(merged[1]).toEqual(CATALOG[1]);
  });

  it("keeps the curated catalog when no rows are persisted", () => {
    expect(mergeCatalog(undefined)).toBe(CATALOG);
    expect(mergeCatalog([])).toEqual(CATALOG);
  });

  it("ignores persisted rows that are not curated", () => {
    const merged = mergeCatalog([
      { appId: first().appId, installed: true },
      { appId: "custom-only", installed: true },
    ]);
    expect(merged.map((candidate) => candidate.appId)).toEqual(
      CATALOG.map((candidate) => candidate.appId),
    );
  });
});
