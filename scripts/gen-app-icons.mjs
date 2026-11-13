import fs from "node:fs/promises";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";
import {
  Activity,
  BookOpen,
  Bot,
  Clapperboard,
  Code2,
  Eye,
  FolderOpen,
  Image,
  LayoutGrid,
  Grid3x3,
  Link2,
  Settings,
  Sparkles,
  SquareTerminal,
  Store,
  Wand2,
} from "lucide-react";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "public", "app-icons");
const SIZE = 192;

const ICONS = [
  ["files", FolderOpen, "#54b8ff", "#1769d2"],
  ["code", Code2, "#ff6da3", "#9d168d"],
  ["terminal", SquareTerminal, "#4b4f57", "#101114"],
  ["claude", Bot, "#e7906f", "#8e5039"],
  ["studio", Image, "#ffb154", "#e74e56"],
  ["reel", Clapperboard, "#9b78ff", "#5430cf"],
  ["viewer", Eye, "#40dfb4", "#09906d"],
  ["store", Store, "#b27aff", "#6534d9"],
  ["create", Wand2, "#4edcf0", "#087f9e"],
  ["monitor", Activity, "#54df73", "#159541"],
  ["assistant", Sparkles, "#c379ff", "#6e2cc8"],
  ["settings", Settings, "#a6abb4", "#4b5059"],
  ["links", Link2, "#b99aff", "#7040d9"],
  ["docs", BookOpen, "#62d0ff", "#0270aa"],
  ["launchpad", LayoutGrid, "#7e8490", "#2d3138"],
  ["mission-control", Grid3x3, "#64748b", "#1f2937"],
];

function glyphMarkup(Icon) {
  return renderToStaticMarkup(
    React.createElement(Icon, {
      width: 92,
      height: 92,
      color: "white",
      strokeWidth: 7.2,
      absoluteStrokeWidth: true,
    }),
  );
}

function tileSvg(Icon, top, bottom) {
  const glyph = glyphMarkup(Icon);
  return `
  <svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="28" y1="12" x2="166" y2="184" gradientUnits="userSpaceOnUse">
        <stop stop-color="${top}"/>
        <stop offset="1" stop-color="${bottom}"/>
      </linearGradient>
      <linearGradient id="shine" x1="96" y1="0" x2="96" y2="112" gradientUnits="userSpaceOnUse">
        <stop stop-color="white" stop-opacity="0.20"/>
        <stop offset="1" stop-color="white" stop-opacity="0"/>
      </linearGradient>
      <radialGradient id="depth" cx="0" cy="0" r="1" gradientTransform="translate(96 177) rotate(-90) scale(82 126)" gradientUnits="userSpaceOnUse">
        <stop stop-color="black" stop-opacity="0.14"/>
        <stop offset="1" stop-color="black" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="192" height="192" rx="43" fill="url(#bg)"/>
    <rect x="1" y="1" width="190" height="190" rx="42" fill="none" stroke="white" stroke-opacity="0.18" stroke-width="2"/>
    <path d="M18 42C18 26.536 30.536 14 46 14H146C161.464 14 174 26.536 174 42V78C141 60 51 60 18 78V42Z" fill="url(#shine)"/>
    <rect width="192" height="192" rx="43" fill="url(#depth)"/>
    <g transform="translate(50 50)">${glyph}</g>
  </svg>`;
}

async function writeWebp(name, input) {
  const file = path.join(OUT, `${name}.webp`);
  await sharp(input)
    .resize(SIZE, SIZE, { fit: "contain" })
    .webp({ quality: 82, alphaQuality: 90, effort: 6 })
    .toFile(file);
  const stat = await fs.stat(file);
  console.log(`${name}.webp\t${Math.round(stat.size / 1024)} KB`);
}

await fs.mkdir(OUT, { recursive: true });
for (const [name, Icon, top, bottom] of ICONS) {
  await writeWebp(name, Buffer.from(tileSvg(Icon, top, bottom)));
}

console.log(`generated ${ICONS.length} WebP app icons in ${OUT}`);
