import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The root layout is inherited by EVERY route, including public pages that render
// nothing but text. `@/features/appshell` is the full generic shell barrel —
// window manager, 5 shells, 10 shell features — so a single static import of it
// anywhere in the root layout's graph puts the entire OS into the initial load of
// every page. That is exactly what `register-sw.tsx` did: /install shipped 330 KB
// gzip to render a static install guide. Deferring it to a dynamic import cut the
// page to 195 KB.
//
// This walks the root layout's LOCAL static imports and fails if the shell is
// back. Dynamic `await import(...)` is fine — that is the fix, not the problem.
const APP = join(dirname(new URL(import.meta.url).pathname));
const SHELL_BARRELS = ["@/features/os-shell", "@/features/appshell"];

function localImports(file: string): string[] {
  const src = readFileSync(file, "utf8");
  // Static imports only. `await import()` is deliberately not matched.
  return [...src.matchAll(/^import\s[^;]*?from\s+["'](\.[^"']+)["']/gm)].map((m) => m[1]);
}
function staticShellImports(file: string): string[] {
  const src = readFileSync(file, "utf8");
  return SHELL_BARRELS.filter((b) =>
    new RegExp(`^import\\s[^;]*?from\\s+["']${b}(/[^"']*)?["']`, "m").test(src),
  );
}
function resolveLocal(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const ext of [".tsx", ".ts", "/index.tsx", "/index.ts"]) {
    try {
      readFileSync(base + ext, "utf8");
      return base + ext;
    } catch {
      /* try the next extension */
    }
  }
  return null;
}

describe("root layout graph", () => {
  it("never statically imports the OS shell", () => {
    const seen = new Set<string>();
    const offenders: string[] = [];
    const walk = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      for (const barrel of staticShellImports(file)) {
        offenders.push(`${file.replace(/^.*\/app\//, "app/")} → ${barrel}`);
      }
      for (const spec of localImports(file)) {
        const next = resolveLocal(file, spec);
        if (next) walk(next);
      }
    };
    walk(join(APP, "layout.tsx"));

    expect(seen.size).toBeGreaterThan(1); // the walk actually followed something
    expect(offenders).toEqual([]);
  });
});
