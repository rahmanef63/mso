// Catalog model + curated store data for the App Store slice. Pure data — no React.
// Each entry carries the full metadata an install needs; installing flips the
// persisted row to installed=true (and the app then appears in the host's
// launcher via useInstalledApps). `glyph` is a key the shell
// resolves through lib/glyph.ts (grid|code|globe|image|music|gauge|folder|cloud).
//
// ONE catalog model covers both lists: the curated installable apps below and
// the OS built-ins in system-catalog.ts. Row metadata (title/gradient/desc) is
// declared once in `CatalogEntryBase`, so the two grids cannot drift apart;
// `CatalogEntry` is the union a renderer takes when it accepts either.

import type { LucideIcon } from "lucide-react";

/** Row metadata every catalog entry shares. */
export type CatalogEntryBase = {
  title: string;
  gradient: string;
  desc: string;
};

export type StoreCategory = "Productivity" | "Media" | "Dev" | "System";

/** Built-in app vs shell feature (the System group renders both). */
export type SystemKind = "app" | "feature";

export type CatalogApp = CatalogEntryBase & {
  appId: string;
  glyph: string; // key into lib/glyph.ts
  runtime: string; // html | node | python | shell
  entry: string; // https URL for html apps, or a stub entry point
  category: StoreCategory;
  /** true installed-state, reconciled from the persisted registry. */
  installed: boolean;
};

/** A built-in app or shell feature toggled on/off (see system-catalog.ts). */
export type SystemEntry = CatalogEntryBase & {
  id: string;
  kind: SystemKind;
  icon: LucideIcon;
  artwork?: string;
  required?: boolean; // can never be disabled (the App Store itself)
};

/** Either catalog row. Narrow with `"appId" in entry`. */
export type CatalogEntry = CatalogApp | SystemEntry;

export const CATEGORIES: StoreCategory[] = [
  "Productivity",
  "Media",
  "Dev",
  "System",
];

// Featured app id (the editor's-choice hero card highlights this entry).
export const FEATURED_ID = "siteforge";

export const CATALOG: CatalogApp[] = [
  {
    appId: "siteforge",
    title: "SiteForge",
    glyph: "globe",
    gradient: "linear-gradient(160deg,#7a5cff,#4f2fd6)",
    runtime: "html",
    entry: "https://excalidraw.com",
    category: "Dev",
    desc: "Static-site builder with a live preview canvas.",
    installed: false,
  },
  {
    appId: "pixel-paint",
    title: "Pixel Paint",
    glyph: "image",
    gradient: "linear-gradient(160deg,#ff8a3d,#ff5fa2)",
    runtime: "html",
    entry: "https://www.tldraw.com",
    category: "Media",
    desc: "Raster painting with layers and brushes.",
    installed: false,
  },
  {
    appId: "coderunner",
    title: "CodeRunner",
    glyph: "code",
    gradient: "linear-gradient(160deg,#3aa0ff,#1f6dff)",
    runtime: "node",
    entry: "main.js",
    category: "Dev",
    desc: "Run Node scripts in a sandboxed worker.",
    installed: false,
  },
  {
    appId: "datacrunch",
    title: "DataCrunch",
    glyph: "gauge",
    gradient: "linear-gradient(160deg,#16c2c2,#0a8a8a)",
    runtime: "python",
    entry: "app.py",
    category: "Dev",
    desc: "Python notebooks for host telemetry analysis.",
    installed: false,
  },
  {
    appId: "vault",
    title: "Vault",
    glyph: "cloud",
    gradient: "linear-gradient(160deg,#5b6070,#2b2f3a)",
    runtime: "shell",
    entry: "run.sh",
    category: "System",
    desc: "Encrypted backups straight to your VPS.",
    installed: false,
  },
  {
    appId: "waveforge",
    title: "WaveForge",
    glyph: "music",
    gradient: "linear-gradient(160deg,#34d39a,#0f9e6a)",
    runtime: "html",
    entry: "https://www.beepbox.co",
    category: "Media",
    desc: "Multitrack audio sketching in the browser.",
    installed: false,
  },
];

// Row shape of the persisted app registry.
type CatalogRow = {
  appId: string;
  installed: boolean;
};

// Merge the curated catalog with the live `listAll` rows so install state is
// reflected. Convex rows win on `installed`; rows that exist only in Convex
// (e.g. custom apps) are ignored here — the store curates its own catalog.
export function mergeCatalog(
  rows: ReadonlyArray<CatalogRow> | undefined,
): CatalogApp[] {
  if (!rows) return CATALOG;
  const state = new Map(rows.map((r) => [r.appId, r.installed]));
  return CATALOG.map((app) => ({
    ...app,
    installed: state.get(app.appId) ?? app.installed,
  }));
}
