import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  installModularFeaturePackage,
  listModularFeatures,
  ModularFeatureError,
  readModularFeatureAsset,
} from "./registry";

const dirs: string[] = [];
function tempDir(prefix: string) {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makePackage(root: string, overrides: Record<string, unknown> = {}, html = "<h1>v1</h1>") {
  const pkg = path.join(root, "pkg");
  mkdirSync(path.join(pkg, "dist"), { recursive: true });
  writeFileSync(path.join(pkg, "dist", "index.html"), html);
  writeFileSync(
    path.join(pkg, "manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      id: "status-board",
      version: "1.0.0",
      title: "Status Board",
      minRole: "operator",
      entry: "index.html",
      ...overrides,
    }),
  );
  return pkg;
}

describe("modular feature registry", () => {
  it("installs, upgrades atomically, enforces minRole, and serves verified assets", () => {
    const work = tempDir("mso-mod-work-");
    const store = tempDir("mso-mod-store-");
    const pkg1 = makePackage(work, { version: "1.0.0" }, "<h1>v1</h1>");

    const installed = installModularFeaturePackage(pkg1, store);
    expect(installed.version).toBe("1.0.0");
    expect(installed.integrity).toMatch(/^sha256-[a-f0-9]{64}$/);

    // Viewer cannot see operator-only feature; operator and owner can.
    expect(listModularFeatures("viewer", store).features).toEqual([]);
    expect(listModularFeatures("operator", store).features).toHaveLength(1);
    expect(() => readModularFeatureAsset("status-board", "index.html", "viewer", store)).toThrow(ModularFeatureError);

    const v1Asset = readModularFeatureAsset("status-board", "index.html", "operator", store);
    expect(v1Asset.bytes.toString("utf8")).toBe("<h1>v1</h1>");
    expect(v1Asset.version).toBe("1.0.0");

    // Hot-upgrade in place without restarting core.
    const pkg2 = makePackage(tempDir("mso-mod-work2-"), { version: "1.1.0" }, "<h1>v2</h1>");
    installModularFeaturePackage(pkg2, store);
    const v2Asset = readModularFeatureAsset("status-board", "index.html", "owner", store);
    expect(v2Asset.bytes.toString("utf8")).toBe("<h1>v2</h1>");
    expect(v2Asset.version).toBe("1.1.0");
  });

  it("blocks path traversal, symlink escapes, and tampered entry bundles", () => {
    const work = tempDir("mso-mod-sec-");
    const store = tempDir("mso-mod-store-sec-");
    const secretFile = path.join(work, "secret.txt");
    writeFileSync(secretFile, "top-secret");

    const pkg = makePackage(work, { id: "secure-app", minRole: "viewer" }, "<h1>clean</h1>");
    installModularFeaturePackage(pkg, store);

    expect(() => readModularFeatureAsset("secure-app", "../manifest.json", "owner", store)).toThrow(/invalid_asset_path/);

    // Symlink escape inside dist/ is refused.
    symlinkSync(secretFile, path.join(store, "secure-app", "dist", "leak.txt"));
    expect(() => readModularFeatureAsset("secure-app", "leak.txt", "owner", store)).toThrow(/asset_path_outside_package/);

    // Symlinked ancestor directory escaping dist/ is refused.
    symlinkSync(work, path.join(store, "secure-app", "dist", "escape-dir"));
    expect(() => readModularFeatureAsset("secure-app", "escape-dir/secret.txt", "owner", store)).toThrow(/asset_path_outside_package/);

    // Tampering with entry file after install fails integrity check.
    writeFileSync(path.join(store, "secure-app", "dist", "index.html"), "<h1>tampered</h1>");
    expect(() => readModularFeatureAsset("secure-app", "index.html", "owner", store)).toThrow(/entry_integrity_mismatch/);

    // Symlinked manifest.json is ignored by listModularFeatures and refused on read.
    const symlinkPkg = path.join(store, "symlink-manifest");
    mkdirSync(path.join(symlinkPkg, "dist"), { recursive: true });
    symlinkSync(path.join(store, "secure-app", "manifest.json"), path.join(symlinkPkg, "manifest.json"));
    expect(listModularFeatures("owner", store).features.map((f) => f.id)).not.toContain("symlink-manifest");
    expect(() => readModularFeatureAsset("symlink-manifest", "index.html", "owner", store)).toThrow(/feature_not_found/);
  });
});
