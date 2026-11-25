import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { APPLE_CHROME, APPLE_MOTION, APPLE_Z } from "../src/lib/shell/apple-config.ts";
import { APPLE_DEVICES } from "../src/lib/shell/apple-devices.ts";
import {
  APPLE_ACCENTS,
  APPLE_WALLPAPERS,
  appleWallpaperCss,
  computeAppleVars,
} from "../src/lib/shell/apple-theme.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const RUST_CORE = readFileSync(
  resolve(REPO_ROOT, "rust-shell/crates/mso-shell-core/src/apple_shell.rs"),
  "utf8",
);
const TAURI_MAIN = readFileSync(resolve(REPO_ROOT, "rust-shell/desktop-tauri/src/main.rs"), "utf8");

function rustConstBlock(name: string): string {
  const start = RUST_CORE.indexOf(`pub const ${name}`);
  assert.notEqual(start, -1, `apple_shell.rs must declare pub const ${name}`);
  const next = RUST_CORE.indexOf("\npub ", start + 1);
  return RUST_CORE.slice(start, next === -1 ? undefined : next);
}

function rustDeviceBlocks(): Map<string, string> {
  const block = rustConstBlock("APPLE_DEVICES");
  const blocks = new Map<string, string>();
  for (const chunk of block.split("DeviceSpec {").slice(1)) {
    const id = chunk.match(/id:\s*"(\w+)"/)?.[1];
    assert.ok(id, "every DeviceSpec must declare a string id");
    blocks.set(id, chunk);
  }
  return blocks;
}

function rustThemeTokens(branch: "if dark" | "else"): Record<string, string> {
  const fnStart = RUST_CORE.indexOf("pub fn compute_theme_vars");
  assert.notEqual(fnStart, -1, "apple_shell.rs must define compute_theme_vars");
  const elseIdx = RUST_CORE.indexOf("} else {", fnStart);
  const a11yIdx = RUST_CORE.indexOf("if a11y.reduce_transparency", elseIdx);
  assert.ok(elseIdx > fnStart && a11yIdx > elseIdx, "compute_theme_vars shape changed");
  const slice = branch === "if dark"
    ? RUST_CORE.slice(fnStart, elseIdx)
    : RUST_CORE.slice(elseIdx, a11yIdx);
  const tokens: Record<string, string> = {};
  for (const match of slice.matchAll(/(\w+):\s*"([^"]*)",/g)) {
    tokens[match[1]] = match[2];
  }
  assert.ok(Object.keys(tokens).length > 10, `expected theme tokens in ${branch} branch`);
  return tokens;
}

function rustWallpapers(): Record<string, { dark: string; light: string }> {
  const fnStart = RUST_CORE.indexOf("pub const fn wallpaper_css");
  assert.notEqual(fnStart, -1, "apple_shell.rs must define wallpaper_css");
  const slice = RUST_CORE.slice(fnStart, RUST_CORE.indexOf("\n}\n", fnStart));
  const out: Record<string, { dark: string; light: string }> = {};
  for (const match of slice.matchAll(
    /\(AppleWallpaper::(\w+), (true|false)\) => \{\s*"([^"]+)"/g,
  )) {
    const id = match[1].toLowerCase();
    const entry = out[id] ?? { dark: "", light: "" };
    entry[match[2] === "true" ? "dark" : "light"] = match[3];
    out[id] = entry;
  }
  return out;
}

function rustChrome(): Record<string, number> {
  const block = rustConstBlock("CHROME_GEOMETRY");
  const chrome: Record<string, number> = {};
  for (const match of block.matchAll(/(\w+):\s*(\d+),/g)) {
    const camel = match[1].replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    chrome[camel] = Number(match[2]);
  }
  return chrome;
}

function rustMotion(): Record<string, string> {
  const block = rustConstBlock("MOTION_TIMINGS");
  const motion: Record<string, string> = {};
  for (const match of block.matchAll(/(\w+):\s*"([^"]+)",/g)) {
    motion[match[1]] = match[2];
  }
  return motion;
}

function rustZIndex(): Record<string, number> {
  const block = rustConstBlock("Z_INDEX_SCALE");
  const scale: Record<string, number> = {};
  for (const match of block.matchAll(/(\w+):\s*(\d+),/g)) {
    const camel = match[1].replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    scale[camel] = Number(match[2]);
  }
  return scale;
}

test("device breakpoints and frame dimensions match between Rust and TypeScript", () => {
  const rust = rustDeviceBlocks();
  assert.deepEqual([...rust.keys()], APPLE_DEVICES.map((d) => d.id));

  for (const device of APPLE_DEVICES) {
    const block = rust.get(device.id);
    assert.ok(block, `Rust registry missing device ${device.id}`);

    const rustMaxW = block.match(/max_w:\s*(Some\((\d+)\)|None)/);
    assert.ok(rustMaxW, `${device.id} must declare max_w`);
    if (Number.isFinite(device.maxW)) {
      assert.equal(Number(rustMaxW[2]), device.maxW, `${device.id} breakpoint drift`);
    } else {
      assert.equal(rustMaxW[1], "None", `${device.id} must map Infinity to None`);
    }

    const rustFrame = block.match(
      /frame:\s*(None|Some\(DeviceFrame \{\s*w:\s*(\d+),\s*h:\s*(\d+),\s*radius:\s*(\d+),\s*bezel:\s*(\d+),?\s*\}\)),/,
    );
    assert.ok(rustFrame, `${device.id} must declare a parseable frame`);
    if (device.frame === null) {
      assert.equal(rustFrame[1], "None", `${device.id} must have a null frame`);
      continue;
    }
    assert.deepEqual(
      {
        w: Number(rustFrame[2]),
        h: Number(rustFrame[3]),
        radius: Number(rustFrame[4]),
        bezel: Number(rustFrame[5]),
      },
      device.frame,
      `${device.id} frame drift`,
    );
  }
});

test("chrome geometry, motion timings, and z-index scale match", () => {
  const chrome = rustChrome();
  assert.deepEqual(Object.keys(chrome).sort(), Object.keys(APPLE_CHROME).sort());
  for (const [key, value] of Object.entries(APPLE_CHROME)) {
    assert.equal(chrome[key], value, `CHROME_GEOMETRY.${key} drift`);
  }

  const motion = rustMotion();
  assert.equal(motion.base, APPLE_MOTION.base, "MOTION_TIMINGS.base drift");
  assert.equal(motion.fast, APPLE_MOTION.fast, "MOTION_TIMINGS.fast drift");

  const z = rustZIndex();
  assert.deepEqual(Object.keys(z).sort(), Object.keys(APPLE_Z).sort());
  for (const [key, value] of Object.entries(APPLE_Z)) {
    assert.equal(z[key], value, `Z_INDEX_SCALE.${key} drift`);
  }
});

test("dark and light theme token values match", () => {
  const camel = (key: string) => key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  for (const [dark, branch] of [[true, "if dark"], [false, "else"]] as const) {
    const rust = rustThemeTokens(branch);
    const ts = computeAppleVars(dark, {}, APPLE_ACCENTS[0]);
    for (const [key, value] of Object.entries(rust)) {
      assert.equal(
        ts[camel(key) as keyof typeof ts],
        value,
        `${dark ? "dark" : "light"} token ${key} drift (Rust: ${value})`,
      );
    }
    assert.equal(rust.blur, ts.blur, "blur drift");
    assert.equal(ts.tint, APPLE_ACCENTS[0], "tint must follow the accent argument");
  }
});

test("accent palette hexes match", () => {
  const block = rustConstBlock("APPLE_ACCENTS");
  const hexes = [...block.matchAll(/"#([0-9a-f]{6})"/gi)].map((m) => `#${m[1].toLowerCase()}`);
  assert.deepEqual(hexes, [...APPLE_ACCENTS], "accent palette drift");
});

test("wallpaper gradient stacks match for every wallpaper and appearance", () => {
  const rust = rustWallpapers();
  assert.deepEqual(Object.keys(rust).sort(), Object.keys(APPLE_WALLPAPERS).sort());
  for (const id of Object.keys(APPLE_WALLPAPERS) as Array<keyof typeof APPLE_WALLPAPERS>) {
    assert.equal(appleWallpaperCss(id, true), rust[id].dark, `${id} dark gradient drift`);
    assert.equal(appleWallpaperCss(id, false), rust[id].light, `${id} light gradient drift`);
    assert.equal(rust[id].dark, APPLE_WALLPAPERS[id].dark, `${id} dark SSOT drift`);
    assert.equal(rust[id].light, APPLE_WALLPAPERS[id].light, `${id} light SSOT drift`);
  }
});

test("tauri main.rs consumes the Rust apple_shell constants for window validation", () => {
  assert.match(TAURI_MAIN, /use mso_shell_core::apple_shell::\{[^}]*APPLE_DEVICES[^}]*\}/);
  assert.match(TAURI_MAIN, /use mso_shell_core::apple_shell::\{[^}]*CHROME_GEOMETRY[^}]*\}/);
  assert.match(TAURI_MAIN, /fn validate_main_window_geometry/);
  assert.match(TAURI_MAIN, /validate_main_window_geometry\(\s*Some\(window_config\.width\),\s*Some\(window_config\.height\),\s*window_config\.min_height,/);
  assert.match(TAURI_MAIN, /fn desktop_frame_floor/);
  assert.equal(/resolve_device_mode\(w\)/.test(TAURI_MAIN), true);
  assert.equal(/mac_menu_bar \+ CHROME_GEOMETRY\.mac_toolbar/.test(TAURI_MAIN), true);
});
