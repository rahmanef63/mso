#!/usr/bin/env node
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const home = os.homedir();
const argv = process.argv.slice(2);

function option(name) {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(name + " requires a path");
  return value;
}

const stage = path.resolve(option("--stage") ?? process.env.MSO_OPENAI_PLUGIN_STAGE ?? path.join(home, ".mso", "private", "plugin-packages", "mso"));
const marketplace = path.resolve(option("--marketplace") ?? path.join(home, ".agents", "plugins", "marketplace.json"));
const cache = path.resolve(option("--cache") ?? path.join(home, ".codex", "plugins", "cache"));

const canonicalId = (value) =>
  /^(?:asdk_app_|connector_|templated_apps_)[A-Za-z0-9][A-Za-z0-9_-]*$/.test(String(value ?? ""));

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function isSafePrivatePath(target, expectedMode) {
  try {
    const st = await fs.stat(target);
    return (st.mode & 0o777) === expectedMode;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function marketplaceDeclaresMso() {
  const state = await readJson(marketplace);
  if (!state || !Array.isArray(state.plugins)) return false;
  return state.plugins.some((plugin) => plugin?.name === "mso");
}

async function cachedMsoInstalls() {
  let marketplaces;
  try {
    marketplaces = await fs.readdir(cache, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }

  let count = 0;
  for (const market of marketplaces) {
    if (!market.isDirectory()) continue;
    const marketDir = path.join(cache, market.name);
    let plugins = [];
    try {
      plugins = await fs.readdir(marketDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const plugin of plugins) {
      if (!plugin.isDirectory() || plugin.name !== "mso") continue;
      const pluginDir = path.join(marketDir, plugin.name);
      let versions = [];
      try {
        versions = await fs.readdir(pluginDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const version of versions) {
        if (!version.isDirectory()) continue;
        const manifest = await readJson(path.join(pluginDir, version.name, ".codex-plugin", "plugin.json"));
        if (manifest?.name === "mso") count += 1;
      }
    }
  }
  return count;
}

const pluginManifest = await readJson(path.join(stage, ".codex-plugin", "plugin.json"));
const appManifest = await readJson(path.join(stage, ".app.json"));
const binding = appManifest?.apps?.mso;
const bindingValid = Boolean(binding && canonicalId(binding.id) && binding.required === true);
const staged = Boolean(pluginManifest && appManifest);
const stageModeSafe = await isSafePrivatePath(stage, 0o700);
const appModeSafe = await isSafePrivatePath(path.join(stage, ".app.json"), 0o600);
const manifestLinksApp = pluginManifest?.apps === "./.app.json";
const marketplaceDeclared = await marketplaceDeclaresMso();
const installedCacheCount = await cachedMsoInstalls();

const status = {
  staged,
  stageModeSafe,
  appModeSafe,
  manifestLinksApp,
  bindingPresent: Boolean(binding),
  bindingValid,
  marketplaceDeclared,
  installedCacheCount,
};

console.log(
  [
    "openai-app: staged=" + (status.staged ? "yes" : "no"),
    "private-modes=" + (status.stageModeSafe && status.appModeSafe ? "safe" : "check"),
    "manifest-link=" + (status.manifestLinksApp ? "ok" : "missing"),
    "binding=" + (status.bindingValid ? "present(redacted)" : status.bindingPresent ? "invalid(redacted)" : "missing"),
    "marketplace-declared=" + (status.marketplaceDeclared ? "yes" : "no"),
    "installed-cache=" + status.installedCacheCount,
  ].join("; "),
);

if (!status.staged || !status.manifestLinksApp || !status.bindingValid || !status.stageModeSafe || !status.appModeSafe) {
  console.error("openai-app: private package is not installation-ready; App ID remains redacted");
  process.exitCode = 2;
} else if (!status.marketplaceDeclared || status.installedCacheCount === 0) {
  console.log(
    "openai-app: package is staged only. Staging does not install or refresh ChatGPT. Native MCP Apps acceptance must run through the registered app/direct app context or an actually installed plugin package.",
  );
} else {
  console.log(
    "openai-app: a local marketplace declaration and cached MSO plugin install were detected on this machine; start a new client conversation before native MCP Apps acceptance.",
  );
}
