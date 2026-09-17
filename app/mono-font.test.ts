import { readFileSync, existsSync } from "node:fs";
import { expect, it } from "vitest";
it("keeps the same local mono typeface and root variable without global preloading", () => {
  const source = readFileSync("app/mono-font.ts", "utf8");
  expect(source).toContain("preload: false");
  expect(source).toContain('variable: "--font-geist-mono"');
  expect(source).toContain('display: "swap"');
  expect(source).not.toContain("next/font/google");
  expect(existsSync("node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2")).toBe(true);
  expect(readFileSync("app/layout.tsx", "utf8")).toContain("GeistMono.variable");
});
