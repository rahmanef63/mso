import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SRC_DIR = join(ROOT, "src");

function collectFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(fullPath, out);
    } else if (entry.isFile()) {
      out.push(fullPath);
    }
  }
  return out;
}

test("static/manifest.webmanifest is valid standalone PWA manifest", () => {
  const raw = readFileSync(join(ROOT, "static", "manifest.webmanifest"), "utf8");
  const manifest = JSON.parse(raw) as Record<string, unknown>;
  assert.equal(manifest.name, "MSO Cockpit");
  assert.equal(manifest.short_name, "MSO");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.background_color, "#121212");
  assert.equal(manifest.theme_color, "#121212");
});

test("src/app.html declares iOS PWA standalone, viewport-fit, manifest, and light/dark theme-color tags", () => {
  const html = readFileSync(join(SRC_DIR, "app.html"), "utf8");
  assert.match(html, /<meta\s+name="viewport"\s+content="[^"]*viewport-fit=cover[^"]*"\s*\/>/);
  assert.match(html, /<meta\s+name="apple-mobile-web-app-capable"\s+content="yes"\s*\/>/);
  assert.match(html, /<meta\s+name="mobile-web-app-capable"\s+content="yes"\s*\/>/);
  assert.match(
    html,
    /<meta\s+name="apple-mobile-web-app-status-bar-style"\s+content="black-translucent"\s*\/>/,
  );
  assert.match(html, /<meta\s+name="apple-mobile-web-app-title"\s+content="MSO"\s*\/>/);
  assert.match(html, /<link\s+rel="manifest"\s+href="\/manifest\.webmanifest"\s*\/>/);
  assert.match(
    html,
    /<meta\s+name="theme-color"\s+media="\(prefers-color-scheme:\s*light\)"\s+content="#f5f5f5"\s*\/>/,
  );
  assert.match(
    html,
    /<meta\s+name="theme-color"\s+media="\(prefers-color-scheme:\s*dark\)"\s+content="#121212"\s*\/>/,
  );
});

test("src/styles.css applies safe-area-inset padding for iOS standalone viewport", () => {
  const css = readFileSync(join(SRC_DIR, "styles.css"), "utf8");
  assert.ok(css.includes("env(safe-area-inset-top)"), "expected env(safe-area-inset-top)");
  assert.ok(css.includes("env(safe-area-inset-right)"), "expected env(safe-area-inset-right)");
  assert.ok(css.includes("env(safe-area-inset-bottom)"), "expected env(safe-area-inset-bottom)");
  assert.ok(css.includes("env(safe-area-inset-left)"), "expected env(safe-area-inset-left)");
});

test("security and antislop static audit across frontend/svelte/src", () => {
  const allFiles = collectFiles(SRC_DIR);
  const svelteFiles = allFiles.filter((file) => extname(file) === ".svelte");
  const codeFiles = allFiles.filter((file) => {
    const ext = extname(file);
    return ext === ".svelte" || ext === ".ts";
  });

  assert.ok(svelteFiles.length > 0, "expected at least one .svelte file under src/");
  assert.ok(codeFiles.length > 0, "expected at least one .svelte or .ts file under src/");

  const rawHtmlHits: string[] = [];
  const emDashHits: string[] = [];
  const nativeDialogHits: string[] = [];
  const nativeDialogPattern = /\bwindow\.(?:confirm|alert|prompt)\(/;

  for (const file of svelteFiles) {
    const content = readFileSync(file, "utf8");
    if (content.includes("{@html")) {
      rawHtmlHits.push(relative(ROOT, file));
    }
  }

  for (const file of codeFiles) {
    const content = readFileSync(file, "utf8");
    const rel = relative(ROOT, file);
    if (content.includes("\u2014")) {
      emDashHits.push(rel);
    }
    if (nativeDialogPattern.test(content)) {
      nativeDialogHits.push(rel);
    }
  }

  assert.deepEqual(rawHtmlHits, [], `disallowed {@html usage in: ${rawHtmlHits.join(", ")}`);
  assert.deepEqual(emDashHits, [], `disallowed U+2014 em dash in: ${emDashHits.join(", ")}`);
  assert.deepEqual(
    nativeDialogHits,
    [],
    `disallowed window.confirm/alert/prompt in: ${nativeDialogHits.join(", ")}`,
  );
});
