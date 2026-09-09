#!/usr/bin/env node
// Passive WCAG AA contrast audit. Scans app/globals.css :root + [data-theme="dark"]
// AND every tweakcn preset under lib/appearance/presets/registry-data.json.
// Computes contrast for the 4 key foreground/background pairs in each preset.
// Fails on palette regressions. Parses hex / rgb[a] / oklch.
import { readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = pathResolve(fileURLToPath(import.meta.url), "../..");
const PAIRS = [
  ["foreground", "background", 4.5, "text"],
  ["muted-foreground", "background", 4.5, "muted text"],
  ["primary-foreground", "primary", 4.5, "primary btn"],
  ["destructive-foreground", "destructive", 4.5, "destructive"],
];

// ── parsers → linear RGB triple [0,1] ─────────────────────────────────────
function srgbToLin(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function parseHex(s) {
  const m = s.match(/^#([0-9a-f]{3,8})$/i); if (!m) return null;
  let h = m[1]; if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length < 6) return null;
  return [srgbToLin(parseInt(h.slice(0,2),16)), srgbToLin(parseInt(h.slice(2,4),16)), srgbToLin(parseInt(h.slice(4,6),16))];
}
function parseRgb(s) {
  const m = s.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  return m ? [srgbToLin(+m[1]), srgbToLin(+m[2]), srgbToLin(+m[3])] : null;
}
// oklch → linear sRGB (good-enough conversion; ignores OOG clamping)
function oklchToLin(s) {
  const m = s.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.-]+)/i); if (!m) return null;
  const L = +m[1], C = +m[2], h = (+m[3]) * Math.PI / 180;
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const lc = l_ * l_ * l_, mc = m_ * m_ * m_, sc = s_ * s_ * s_;
  return [
    +4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc,
    -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc,
    -0.0041960863 * lc - 0.7034186147 * mc + 1.7076147010 * sc,
  ].map((v) => Math.max(0, Math.min(1, v)));
}
function toLin(raw) {
  if (!raw) return null;
  const s = raw.trim();
  return parseHex(s) ?? parseRgb(s) ?? oklchToLin(s);
}
const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
function ratio(a, b) { const [L1, L2] = [lum(a), lum(b)].sort((x, y) => y - x); return (L1 + 0.05) / (L2 + 0.05); }

// ── presets ───────────────────────────────────────────────────────────────
const reg = JSON.parse(readFileSync(join(ROOT, "lib/appearance/presets/registry-data.json"), "utf8"));
const fails = { light: [], dark: [] };
let scanned = 0;
for (const item of reg.items) {
  for (const mode of ["light", "dark"]) {
    const v = item.cssVars?.[mode]; if (!v) continue;
    scanned++;
    for (const [fgK, bgK, min, label] of PAIRS) {
      const fg = toLin(v[fgK]), bg = toLin(v[bgK]); if (!fg || !bg) continue;
      const r = ratio(fg, bg);
      if (r < min) fails[mode].push({ preset: item.name, pair: label, ratio: r.toFixed(2), min });
    }
  }
}

// ── globals.css :root + [data-theme=dark] (raw hex / rgba) ────────────────
const css = readFileSync(join(ROOT, "app/globals.css"), "utf8");
function extractBlock(re) {
  const m = css.match(re); if (!m) return {};
  const out = {}; for (const line of m[1].split("\n")) {
    const mm = line.match(/--([a-z0-9-]+)\s*:\s*([^;]+);/i);
    if (mm) out[mm[1]] = mm[2].trim();
  } return out;
}
// Crude: read first {...} after the selector — fine for our block layout.
const root = extractBlock(/:root\s*\{([\s\S]*?)\}/);
const dark = extractBlock(/\[data-theme="dark"\]\s*\{([\s\S]*?)\}/);
function resolve(vars, key) {
  let v = vars[key]; let hops = 0;
  while (v && /^var\(--/.test(v) && hops++ < 4) {
    const ref = v.match(/var\(--([a-z0-9-]+)/i)?.[1];
    v = ref ? vars[ref] ?? root[ref] : null;
  }
  return v;
}
for (const [name, vars] of [["light", root], ["dark", { ...root, ...dark }]]) {
  for (const [fgK, bgK, min, label] of PAIRS) {
    const fg = toLin(resolve(vars, fgK)), bg = toLin(resolve(vars, bgK)); if (!fg || !bg) continue;
    const r = ratio(fg, bg);
    if (r < min) fails[name].push({ preset: "globals.css", pair: label, ratio: r.toFixed(2), min });
  }
}

console.log(`Contrast audit — scanned ${reg.items.length} presets × 2 modes + globals.css`);
for (const mode of ["light", "dark"]) {
  console.log(`\n${mode.toUpperCase()}: ${fails[mode].length} fail(s) below WCAG AA 4.5:1`);
  for (const f of fails[mode]) console.log(`  - ${f.preset.padEnd(20)} ${f.pair.padEnd(14)} ${f.ratio} (need ${f.min})`);
}
if (fails.light.length || fails.dark.length) process.exitCode = 1;
