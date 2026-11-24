import fs from 'node:fs';
import path from 'node:path';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';

const ROUTE = '/[[...slug]]/page';
const ENTRY = '[project]/app' + ROUTE;
const sum = rows => ({ files: rows.length, bytes: rows.reduce((n, r) => n + r.bytes, 0),
  gzip: rows.reduce((n, r) => n + r.gzip, 0), brotli: rows.reduce((n, r) => n + r.brotli, 0) });

const HEAVY_SIGNATURES = {
  ReactFlow: 'react-flow__renderer',
  Konva: 'Konva error',
  Xterm: 'xterm-screen',
  ONNX: 'ort-wasm-simd-threaded',
};

export function parseClientManifest(source) {
  // Read the generated JSON assignment without evaluating JavaScript from the build.
  const match = source.match(/globalThis\.__RSC_MANIFEST\["[^" ]+"\]\s*=\s*(\{[\s\S]*\});?\s*$/);
  if (!match) throw new Error('Unsupported client manifest format; update the parser, do not skip the budget');
  return JSON.parse(match[1]);
}

function measureFiles(baseDir, relPaths) {
  return [...new Set(relPaths)].map(file => {
    const resolved = path.resolve(baseDir, file);
    if (!resolved.startsWith(baseDir + path.sep)) throw new Error('Bundle asset escaped static build root');
    const data = fs.readFileSync(resolved);
    return {
      path: file,
      bytes: data.length,
      gzip: gzipSync(data).length,
      brotli: brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 6 } }).length,
    };
  });
}

function readSvelteBundleReport(root) {
  const build = path.resolve(root, 'frontend/svelte/build');
  const html = fs.readFileSync(path.join(build, 'index.html'), 'utf8');
  const assetRefs = [...html.matchAll(/(?:href|src)=["']\/?(_app\/immutable\/[^"']+)["']/g)].map(m => m[1]);
  const entryMatches = [...html.matchAll(/import\(["']\/?(_app\/immutable\/[^"']+)["']\)/g)].map(m => m[1]);
  const allRefs = [...new Set([...assetRefs, ...entryMatches])];
  const jsRefs = allRefs.filter(p => p.endsWith('.js') || p.endsWith('.mjs'));
  const cssRefs = allRefs.filter(p => p.endsWith('.css'));
  const fontRefs = allRefs.filter(p => p.endsWith('.woff2'));
  if (!jsRefs.length) throw new Error('Missing Svelte shell entry chunks in frontend/svelte/build/index.html');

  // Include eager static imports from entry chunks (1 hop) so initial measurement reflects real cold load.
  const eagerJs = new Set(jsRefs);
  const eagerCss = new Set(cssRefs);
  for (const rel of [...jsRefs]) {
    const src = fs.readFileSync(path.join(build, rel), 'utf8');
    const dir = path.posix.dirname(rel);
    for (const m of src.matchAll(/(?:from|import)\s*["'](\.[^"']+\.js)["']/g)) {
      const joined = path.posix.normalize(path.posix.join(dir, m[1]));
      if (joined.startsWith('_app/immutable/')) eagerJs.add(joined);
    }
  }
  const assetsDir = path.join(build, '_app/immutable/assets');
  if (eagerCss.size === 0 && fs.existsSync(assetsDir)) {
    for (const name of fs.readdirSync(assetsDir)) {
      if (name.endsWith('.css')) eagerCss.add(`_app/immutable/assets/${name}`);
    }
  }

  const chunks = measureFiles(build, [...eagerJs]);
  const entry = measureFiles(build, jsRefs);
  const styles = measureFiles(build, [...eagerCss]);
  const fontFiles = measureFiles(build, fontRefs);
  const contents = chunks.map(row => fs.readFileSync(path.join(build, row.path), 'utf8'));
  const initialHeavyModules = Object.entries(HEAVY_SIGNATURES)
    .filter(([, marker]) => contents.some(text => text.includes(marker)))
    .map(([name]) => name);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'frontend/svelte/package.json'), 'utf8'));
  return {
    schemaVersion: 2,
    runtimeKind: 'svelte5',
    svelte: pkg.devDependencies?.svelte ?? 'unknown',
    measurement: 'Eager SvelteKit entry chunks and static imports referenced by index.html. Lazy app slices load on window open.',
    initial: sum(chunks),
    entry: sum(entry),
    runtime: sum(entry),
    css: sum(styles),
    fonts: sum(fontFiles),
    polyfills: [],
    initialHeavyModules,
    chunks,
    styles,
    fontFiles,
  };
}

export function readBundleReport(root = process.cwd()) {
  const svelteIndex = path.resolve(root, 'frontend/svelte/build/index.html');
  const nextBuildId = path.resolve(root, '.next/BUILD_ID');
  if (fs.existsSync(svelteIndex) && !fs.existsSync(nextBuildId)) {
    return readSvelteBundleReport(root);
  }
  const build = path.resolve(root, '.next');
  const readJson = file => JSON.parse(fs.readFileSync(path.join(build, file), 'utf8'));
  const manifest = parseClientManifest(fs.readFileSync(path.join(build, 'server/app' + ROUTE + '_client-reference-manifest.js'), 'utf8'));
  const main = readJson('build-manifest.json');
  const entryPaths = manifest.entryJSFiles?.[ENTRY];
  const cssPaths = manifest.entryCSSFiles?.[ENTRY]?.map(row => row.path);
  if (!entryPaths?.length || !cssPaths?.length || !main.rootMainFiles?.length) throw new Error('Missing shell entry chunks or styles');
  const normalize = asset => {
    if (typeof asset !== 'string') throw new Error('Invalid bundle asset path');
    const relative = asset.replace(/^\/_next\//, '');
    const resolved = path.resolve(build, relative);
    if (!relative.startsWith('static/') || !resolved.startsWith(build + path.sep)) throw new Error('Bundle asset escaped static build root');
    return relative;
  };
  const measure = paths => measureFiles(build, paths.map(normalize));
  const runtime = measure(main.rootMainFiles);
  const entry = measure(entryPaths);
  const chunks = measure([...main.rootMainFiles, ...entryPaths]);
  const styles = measure(cssPaths);
  const fontFiles = measure(readJson('server/next-font-manifest.json').app?.[ENTRY] ?? []);
  const contents = chunks.map(row => fs.readFileSync(path.join(build, row.path), 'utf8'));
  const initialHeavyModules = Object.entries(HEAVY_SIGNATURES).filter(([, marker]) => contents.some(text => text.includes(marker))).map(([name]) => name);
  return { schemaVersion: 1, next: JSON.parse(fs.readFileSync(path.join(root, 'node_modules/next/package.json'), 'utf8')).version,
    measurement: 'Unique eager catch-all chunks plus framework runtime. Nomodule polyfills and runtime-triggered lazy downloads are separate. Compression is estimated, not network transfer.',
    initial: sum(chunks), entry: sum(entry), runtime: sum(runtime), css: sum(styles), fonts: sum(fontFiles),
    polyfills: measure(main.polyfillFiles ?? []), initialHeavyModules, chunks, styles, fontFiles };
}

export function bundleViolations(report, budget) {
  const failures = [];
  const validBytes = value => Number.isFinite(value) && value >= 0;
  if (!budget?.gzipBytes || !Object.keys(budget.gzipBytes).length) return ['Missing gzip bundle budgets'];
  for (const [name, cap] of Object.entries(budget.gzipBytes)) {
    if (!validBytes(cap)) failures.push(`${name}: invalid budget`);
    if (!validBytes(report?.[name]?.gzip)) failures.push(`${name}: missing measurement`);
    else if (validBytes(cap) && report[name].gzip > cap) failures.push(`${name}: ${report[name].gzip} gzip bytes > ${cap}`);
  }
  if (!validBytes(budget.preloadedFontBytes)) failures.push('preloaded fonts: invalid budget');
  if (!validBytes(report?.fonts?.bytes)) failures.push('preloaded fonts: missing measurement');
  else if (validBytes(budget.preloadedFontBytes) && report.fonts.bytes > budget.preloadedFontBytes) failures.push(`preloaded fonts: ${report.fonts.bytes} > ${budget.preloadedFontBytes}`);
  if (!Array.isArray(report?.initialHeavyModules)) failures.push('Missing eager engine scan');
  else for (const name of report.initialHeavyModules) failures.push(`${name} runtime leaked into the eager shell graph`);
  return failures;
}
