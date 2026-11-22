// Node.js module resolution hook so `node scripts/server.mjs` resolves `@/*`,
// `next/server`, `next/headers`, and `server-only` directly to TypeScript modules
// in `lib/` without needing Next.js or a separate backend compilation step.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const SHIMS = new Map([
  ["next/server", path.join(ROOT, "lib/http/next-server-shim.ts")],
  ["next/headers", path.join(ROOT, "lib/http/next-headers-shim.ts")],
  ["server-only", path.join(ROOT, "lib/http/server-only-shim.ts")],
  ["next/dist/shared/lib/router/utils/relativize-url", path.join(ROOT, "lib/http/next-server-shim.ts")],
]);

const EXTS = ["", ".ts", ".mts", ".js", ".mjs", "/index.ts", "/index.js"];

function tryResolveFile(basePath) {
  for (const ext of EXTS) {
    const candidate = basePath + ext;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return pathToFileURL(candidate).href;
    }
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (SHIMS.has(specifier)) {
    return { url: pathToFileURL(SHIMS.get(specifier)).href, shortCircuit: true };
  }
  if (specifier.startsWith("@/")) {
    const target = path.join(ROOT, specifier.slice(2));
    const resolved = tryResolveFile(target);
    if (resolved) return { url: resolved, shortCircuit: true };
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    const parentDir = path.dirname(fileURLToPath(context.parentURL));
    const resolved = tryResolveFile(path.resolve(parentDir, specifier));
    if (resolved) return { url: resolved, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.startsWith("file:") && url.endsWith(".json")) {
    const raw = fs.readFileSync(fileURLToPath(url), "utf8");
    return { format: "module", source: `export default ${raw};`, shortCircuit: true };
  }
  return nextLoad(url, context);
}
