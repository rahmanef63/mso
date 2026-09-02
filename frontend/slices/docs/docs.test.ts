import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEEPER, INSTALL_GUIDE, REPO, START_HERE } from "./links";

// Read the sources rather than importing the barrels: `@/features/appshell` pulls
// the whole React shell, which a node-env unit test has no business booting.
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("docs app", () => {
  it("is registered in the shell so it can reach the dock", () => {
    const manifest = read("../os-shell/shell.manifest.ts");
    expect(manifest).toContain('import { docsApp } from "@/features/docs"');
    expect(manifest).toContain('withSlug(withArtwork(docsApp), "docs")');
    // noDock would hide it from the one surface a signed-out visitor looks at.
    expect(read("./index.ts")).not.toContain("noDock");
  });

  it("is promoted while signed out, so the menu matches the state", () => {
    const osRoot = read("../../../app/os-root.tsx");
    expect(osRoot).toContain('status === "out"');
    expect(osRoot).toContain('app.id === "docs"');
  });

  it("leads with the install guide this instance serves itself", () => {
    // Same-origin on purpose: it must work for a visitor who cannot reach GitHub.
    expect(INSTALL_GUIDE.href).toBe("/install");
    expect(START_HERE[0].href).toBe(REPO);
  });

  it("points every external link at the real repo", () => {
    for (const l of [...START_HERE, ...DEEPER]) {
      expect(l.href.startsWith(REPO) || l.href.startsWith("/")).toBe(true);
      expect(l.title.length).toBeGreaterThan(0);
      expect(l.desc.length).toBeGreaterThan(0);
    }
  });
});

describe("quicklinks fallback", () => {
  // Quicklinks are the instance owner's own shortcuts, so they live in that
  // owner's data (~/.mso/prefs.json). What stays in the repo is only what renders
  // when there is no owner data — and it must be true for ANY installer, because
  // this repo is public and the README invites strangers to run it.
  const defaults = (() => {
    const src = read("../../../lib/quicklinks/store.tsx");
    return src.slice(src.indexOf("const DEFAULTS"), src.indexOf("type Ctx"));
  })();

  it("ships nobody's personal accounts", () => {
    // A real account here would seed every stranger's install with it.
    for (const host of ["linkedin.com", "instagram.com", "x.com", "tiktok.com", "youtube.com"]) {
      expect(defaults).not.toContain(host);
    }
    // ...and no profile URL of the maintainer's either.
    expect(defaults).not.toMatch(/github\.com\/[A-Za-z0-9-]+\s*"/);
  });

  it("is not a second copy of the docs", () => {
    // Four GitHub file URLs used to seed here; they belong in the Docs app.
    expect(defaults).not.toContain("/blob/main/");
  });

  it("still renders something, so an empty rail reads as empty and not broken", () => {
    expect(defaults.match(/url:/g)?.length).toBe(1);
    expect(defaults).toContain("https://github.com/rahmanef63/mso");
  });
});
