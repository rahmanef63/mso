import { readFileSync, statSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve as pathResolve } from "node:path";

export const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mjs", ".js"];
const IMPORT_RE = /(?:^|[\s;])(?:(import\s+type\s+[^"']*?from\s+["']([^"']+)["'])|(export\s+type\s+[^"']*?from\s+["']([^"']+)["'])|(export\s*\*\s*from\s+["']([^"']+)["'])|(export\s*\{[^}]*\}\s*from\s+["']([^"']+)["'])|(import\s+[^"']*?from\s+["']([^"']+)["'])|(import\s*["']([^"']+)["']))/g;

export function walkSource(root, dirs = ["frontend", "lib"], extensions = [".ts", ".tsx"]) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (extensions.some((ext) => full.endsWith(ext))) out.push(full);
    }
  };
  for (const dir of dirs) walk(join(root, dir));
  return out;
}

const isFile = (path) => statSync(path, { throwIfNoEntry: false })?.isFile();
function tryResolve(base, extensions) {
  if (isFile(base)) return base;
  for (const ext of extensions) if (isFile(base + ext)) return base + ext;
  for (const ext of extensions) if (isFile(join(base, "index" + ext))) return join(base, "index" + ext);
  return null;
}

export function resolveImport(root, from, spec, extensions = SOURCE_EXTENSIONS) {
  if (spec.startsWith("@/features/")) return tryResolve(join(root, "frontend/slices", spec.slice(11)), extensions);
  if (spec.startsWith("@/")) return tryResolve(join(root, spec.slice(2)), extensions);
  if (spec.startsWith(".")) return tryResolve(pathResolve(dirname(from), spec), extensions);
  return null;
}

export function importsFromSource(source) {
  const rows = [];
  for (const match of source.matchAll(IMPORT_RE)) {
    const spec = match[2] ?? match[4] ?? match[6] ?? match[8] ?? match[10] ?? match[12];
    if (!spec) continue;
    const kind = match[1] || match[3] || match[5] || match[7] ? "type" : "value";
    rows.push({ spec, kind });
  }
  return rows;
}

export function isPureBarrel(source) {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\n)\s*\/\/[^\n]*/g, "");
  if (/(^|\n)\s*import\s+(?!type\b)(?![\s]*["'])/.test(clean)) return false;
  return !/(^|\n)\s*(?:const|let|var|function|class|if|for|while|switch|return|throw|await|async\s+function)\b/.test(clean);
}

export function buildImportGraph(root, options = {}) {
  const dirs = options.dirs ?? ["frontend", "lib"];
  const extensions = options.extensions ?? [".ts", ".tsx"];
  const files = walkSource(root, dirs, extensions);
  const graph = new Map(), barrel = new Map(), imports = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    barrel.set(file, isPureBarrel(source));
    const edges = new Map();
    for (const row of importsFromSource(source)) {
      const target = resolveImport(root, file, row.spec, extensions);
      imports.push({ from: file, to: target, spec: row.spec, kind: row.kind });
      if (!target || target === file) continue;
      if (edges.get(target) !== "value") edges.set(target, row.kind);
    }
    graph.set(file, edges);
  }
  return { files, graph, barrel, imports };
}

export function findCycles(graph, barrel) {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map(), stack = [], cycles = [], seen = new Set();
  const canonical = (ring) => {
    const body = ring.slice(0, -1);
    const variants = body.map((_, i) => [...body.slice(i), ...body.slice(0, i)].join("|"));
    return variants.sort()[0] ?? "";
  };
  const dfs = (node) => {
    color.set(node, GRAY); stack.push(node);
    for (const [next] of graph.get(node) ?? []) {
      const state = color.get(next) ?? WHITE;
      if (state === GRAY) {
        const index = stack.indexOf(next);
        if (index < 0) continue;
        const ring = stack.slice(index).concat(next), key = canonical(ring);
        if (seen.has(key)) continue;
        seen.add(key);
        let anyType = false;
        for (let k = index; k < stack.length; k += 1)
          if (graph.get(stack[k])?.get(stack[k + 1] ?? next) === "type") anyType = true;
        cycles.push({ ring, kind: anyType || barrel.get(next) ? "type" : "value" });
      } else if (state === WHITE) dfs(next);
    }
    stack.pop(); color.set(node, BLACK);
  };
  for (const file of graph.keys()) if ((color.get(file) ?? WHITE) === WHITE) dfs(file);
  return cycles;
}

export const rel = (root, file) => relative(root, file).replaceAll("\\", "/");
