import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { Linter, type ESLint } from "eslint";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const plugin = require("@next/eslint-plugin-next") as ESLint.Plugin;
const { getRootDirs } = require("@next/eslint-plugin-next/dist/utils/get-root-dirs.js") as {
  getRootDirs(context: { cwd: string; settings: { next?: { rootDir?: unknown } } }): string[];
};
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mso-next-glob-"));
  roots.push(root);
  for (const dir of ["one/pages", "one/nested/app", "two/pages", ".hidden", "with space/pages"]) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }
  fs.writeFileSync(path.join(root, "one/pages/about.js"), "export default function About() {}\n");
  fs.writeFileSync(path.join(root, "two/pages/contact.js"), "export default function Contact() {}\n");
  fs.writeFileSync(path.join(root, "not-a-directory"), "fixture");
  const resolve = (rootDir?: unknown) => getRootDirs({ cwd: root, settings: { next: { rootDir } } });
  return { root, resolve, one: path.join(root, "one"), two: path.join(root, "two") };
}

function messages(rootDir: string, href: string) {
  return new Linter().verify(`export default () => <a href="${href}">Link</a>`, [{
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    settings: { next: { rootDir } },
    plugins: { "@next/next": plugin },
    rules: { "@next/next/no-html-link-for-pages": "error" },
  }]);
}

describe("Next ESLint root discovery without the vulnerable braces chain", () => {
  it("uses the maintained replacement only for the audited Next plugin consumer", () => {
    const lock = JSON.parse(fs.readFileSync("bun.lock", "utf8").replace(/,(\s*[}\]])/g, "$1"));
    expect(require("fast-glob/package.json").name).toBe("fast-glob");
    expect(require("micromatch/package.json").name).toBe("picomatch");
    expect(require("micromatch/package.json").version).toBe("2.3.2");
    expect(require("fast-glob/package.json").version).toBe("3.3.1");
    expect(lock.packages.braces).toBeUndefined();
    expect(lock.packages.micromatch[0]).toBe("picomatch@2.3.2");
    const consumers = Object.entries(lock.packages).filter(([, row]) => {
      const entry = row as [string, string, { dependencies?: Record<string, string> }];
      return Object.hasOwn(entry[2]?.dependencies ?? {}, "micromatch");
    }).map(([name]) => name);
    expect(consumers).toEqual(["fast-glob"]);
  });

  it("preserves default cwd and literal roots without expanding descendants", () => {
    const f = fixture();
    expect(f.resolve()).toEqual([f.root]);
    expect(f.resolve(f.one)).toEqual([f.one]);
    const relative = path.relative(process.cwd(), f.one).replace(/\\/g, "/");
    expect(f.resolve(relative)).toEqual([relative]);
    expect(f.resolve(path.join(f.root, "with space"))).toEqual([path.join(f.root, "with space")]);
    expect(f.resolve(path.join(f.root, "absent"))).toEqual([]);
    expect(f.resolve(path.join(f.root, "not-a-directory"))).toEqual([]);
  });

  it("preserves directory-only wildcards, braces, extglobs and hidden-file defaults", () => {
    const f = fixture();
    expect(f.resolve(`${f.root}/*`).sort()).toEqual([f.one, f.two, path.join(f.root, "with space")].sort());
    expect(f.resolve(`${f.root}/{one,two}`).sort()).toEqual([f.one, f.two]);
    expect(f.resolve(`${f.root}/@(one|two)`).sort()).toEqual([f.one, f.two]);
    expect(f.resolve(`${f.root}/!(two)`).sort()).toEqual([f.one, path.join(f.root, ".hidden"), path.join(f.root, "with space")].sort());
    expect(f.resolve(`${f.root}/.*`)).toEqual([path.join(f.root, ".hidden")]);
  });

  it("keeps Next's per-pattern array semantics and Windows slash normalization", () => {
    const f = fixture();
    expect(f.resolve([f.two, f.one, 7])).toEqual([f.two, f.one]);
    expect(f.resolve(`!${f.one}`)).toEqual([]);
    expect(f.resolve([`${f.root}/{one,two}`, `!${f.two}`]).sort()).toEqual([f.one, f.two]);
    expect(f.resolve(f.one.replace(/\//g, "\\"))).toEqual([f.one]);
  });

  it("follows directory symlinks without treating a literal root as recursive", () => {
    const f = fixture(), alias = path.join(f.root, "linked");
    fs.symlinkSync(f.one, alias, process.platform === "win32" ? "junction" : "dir");
    expect(f.resolve(alias)).toEqual([alias]);
    expect(f.resolve(`${f.root}/link*`)).toEqual([alias]);
  });

  it("still reports forbidden Next page links for literal and globbed roots", () => {
    const f = fixture();
    for (const rootDir of [f.one, `${f.root}/{one,two}`, `${f.root}/*`]) {
      expect(messages(rootDir, "/about")).toEqual([expect.objectContaining({
        ruleId: "@next/next/no-html-link-for-pages", severity: 2,
      })]);
      expect(messages(rootDir, "https://example.com/about")).toEqual([]);
    }
  });
  it("preserves trailing slashes and recursive roots without including their parent", () => {
    const f = fixture();
    expect(f.resolve(`${f.one}/`)).toEqual([`${f.one}/`]);
    expect(f.resolve(`${f.one}/**`).sort()).toEqual([
      `${f.one}/nested`, `${f.one}/nested/app`, `${f.one}/pages`,
    ]);
    const alias = path.join(f.root, "linked");
    fs.symlinkSync(f.one, alias, process.platform === "win32" ? "junction" : "dir");
    expect(f.resolve(`${alias}/**`).sort()).toEqual([
      `${alias}/nested`, `${alias}/nested/app`, `${alias}/pages`,
    ]);
  });

  it("preserves brace alternatives, ranges, escaping and deduplication", () => {
    const { expandBraceExpansion: expand } = require("fast-glob/out/utils/pattern.js") as {
      expandBraceExpansion(pattern: string): string[];
    };
    const cases: [string, string[]][] = [
      ["{a,a,b}", ["a", "b"]],
      ["x{a,{b,c}}y", ["xay", "xby", "xcy"]],
      ["{1..3}", ["1", "2", "3"]],
      ["{03..01}", ["03", "02", "01"]],
      ["{a..c}", ["a", "b", "c"]],
      ["{a,b}{1,2}", ["a1", "a2", "b1", "b2"]],
      [String.raw`a\{b,c\}`, ["a{b,c}"]],
      [String.raw`a{b\,c,d}`, ["ad", "ab,c"]],
      ["{a,}", ["a"]],
      ["a/{b,}/{c,}/*", ["a///*", "a/b//*", "a//c/*", "a/b/c/*"]],
      ["${a,b}", ["${a,b}"]],
      ["{{a,b}}", ["{a}", "{b}"]],
    ];
    for (const [pattern, expected] of cases) expect(expand(pattern), pattern).toEqual(expected);
    expect(expand(String.raw`\{`.repeat(40))).toEqual(["{".repeat(40)]);
  });

  it("fails closed on excessive range, product, nesting or input size", () => {
    const { expandBraceExpansion: expand } = require("fast-glob/out/utils/pattern.js") as {
      expandBraceExpansion(pattern: string): string[];
    };
    expect(expand("{1..1000}")).toHaveLength(1000);
    expect(() => expand("{1..1001}")).toThrow("exceeds 1000 results");
    expect(() => expand("{a,b}".repeat(10))).toThrow(RangeError);
    expect(() => expand("{".repeat(33) + "a,b" + "}".repeat(33))).toThrow("exceeds 32 levels");
    expect(() => expand("a".repeat(4097))).toThrow("exceeds 4096 characters");
  });

  it("rejects every library truncation limit consistently through CJS and ESM", async () => {
    type Expand = (pattern: string, options?: {
      max?: number; maxLength?: number; maxDepth?: number; maxRewrites?: number;
    }) => string[];
    const cjs = require("brace-expansion") as { expand: Expand };
    const esm = await import("brace-expansion");
    for (const expand of [cjs.expand, esm.expand]) {
      expect(expand("{1..2}", { max: 2, maxLength: 2 })).toEqual(["1", "2"]);
      expect(() => expand("{1..3}", { max: 2 })).toThrow("configured result limit");
      expect(() => expand("{aa,bb}", { maxLength: 2 })).toThrow("configured length limit");
      expect(() => expand(String.raw`\{`.repeat(20) + "{a,b}", { maxLength: 20 })).toThrow("configured length limit");
      expect(() => expand("x{a,{b,c}}y", { maxDepth: 0 })).toThrow("configured depth limit");
      expect(() => expand("{a},b}", { maxRewrites: 0 })).toThrow("configured rewrite limit");
      expect(() => expand("{a}" + "}".repeat(40) + ",z}", { maxRewrites: 32 })).toThrow("configured rewrite limit");
    }
  });

});
