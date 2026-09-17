import fs from 'node:fs';
import path from 'node:path';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';

const ROUTE = '/[[...slug]]/page';
const ENTRY = '[project]/app' + ROUTE;
const sum = rows => ({ files: rows.length, bytes: rows.reduce((n, r) => n + r.bytes, 0),
  gzip: rows.reduce((n, r) => n + r.gzip, 0), brotli: rows.reduce((n, r) => n + r.brotli, 0) });

export function parseClientManifest(source) {
  // Read the generated JSON assignment without evaluating JavaScript from the build.
  const match = source.match(/globalThis\.__RSC_MANIFEST\["[^" ]+"\]\s*=\s*(\{[\s\S]*\});?\s*$/);
  if (!match) throw new Error('Unsupported client manifest format; update the parser, do not skip the budget');
  return JSON.parse(match[1]);
}

export function readBundleReport(root = process.cwd()) {
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
  const measure = paths => [...new Set(paths.map(normalize))].map(file => {
    const data = fs.readFileSync(path.join(build, file));
    return { path: file, bytes: data.length, gzip: gzipSync(data).length,
      brotli: brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 6 } }).length };
  });
  const runtime = measure(main.rootMainFiles);
  const entry = measure(entryPaths);
  const chunks = measure([...main.rootMainFiles, ...entryPaths]);
  const styles = measure(cssPaths);
  const fontFiles = measure(readJson('server/next-font-manifest.json').app?.[ENTRY] ?? []);
  const contents = chunks.map(row => fs.readFileSync(path.join(build, row.path), 'utf8'));
  const signatures = {
    ReactFlow: 'react-flow__renderer',
    Konva: 'Konva error',
    Xterm: 'xterm-screen',
    ONNX: 'ort-wasm-simd-threaded',
  };
  const initialHeavyModules = Object.entries(signatures).filter(([, marker]) => contents.some(text => text.includes(marker))).map(([name]) => name);
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
