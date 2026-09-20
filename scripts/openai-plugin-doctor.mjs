#!/usr/bin/env node
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const home = os.homedir();
const argv = process.argv.slice(2);
const PORTABLE_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";

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

async function countSkills(root) {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    let count = 0;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const st = await fs.stat(path.join(root, entry.name, "SKILL.md"));
        if (st.isFile()) count += 1;
      } catch {}
    }
    return count;
  } catch (error) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }
}

async function marketplaceDeclaresMso() {
  const state = await readJson(marketplace);
  if (!state || !Array.isArray(state.plugins)) return false;
  return state.plugins.some((plugin) => plugin?.name === "mso");
}

async function installedManifest(pluginVersionDir) {
  const portable = await readJson(path.join(pluginVersionDir, "plugin.json"));
  if (portable?.name === "mso") return portable;
  const compatibility = await readJson(path.join(pluginVersionDir, ".codex-plugin", "plugin.json"));
  return compatibility?.name === "mso" ? compatibility : null;
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
        if (await installedManifest(path.join(pluginDir, version.name))) count += 1;
      }
    }
  }
  return count;
}

const portableManifest = await readJson(path.join(stage, "plugin.json"));
const compatibilityManifest = await readJson(path.join(stage, ".codex-plugin", "plugin.json"));
const appManifest = await readJson(path.join(stage, ".app.json"));
const binding = appManifest?.apps?.mso;

const portableValid = Boolean(
  portableManifest?.$schema === PORTABLE_SCHEMA &&
  portableManifest?.name === "mso" &&
  portableManifest?.extensions?.["com.openai"]?.apps === "./.app.json" &&
  portableManifest?.extensions?.["com.openai"]?.interface &&
  typeof portableManifest.extensions["com.openai"].interface === "object",
);
const compatibilityValid = Boolean(
  compatibilityManifest?.name === "mso" &&
  compatibilityManifest?.skills === "./skills/" &&
  compatibilityManifest?.apps === "./.app.json",
);
const bindingValid = Boolean(binding && canonicalId(binding.id) && binding.required === true);
const staged = Boolean(portableManifest && compatibilityManifest && appManifest);
const skillCount = await countSkills(path.join(stage, "skills"));
const skillsValid = skillCount > 0;

const stageModeSafe = await isSafePrivatePath(stage, 0o700);
const appModeSafe = await isSafePrivatePath(path.join(stage, ".app.json"), 0o600);
const portableModeSafe = await isSafePrivatePath(path.join(stage, "plugin.json"), 0o600);
const compatibilityModeSafe = await isSafePrivatePath(path.join(stage, ".codex-plugin", "plugin.json"), 0o600);
const marketplaceDeclared = await marketplaceDeclaresMso();
const installedCacheCount = await cachedMsoInstalls();

const status = {
  staged,
  stageModeSafe,
  appModeSafe,
  portableModeSafe,
  compatibilityModeSafe,
  portableValid,
  compatibilityValid,
  skillsValid,
  skillCount,
  bindingPresent: Boolean(binding),
  bindingValid,
  marketplaceDeclared,
  installedCacheCount,
};

console.log(
  [
    "openai-app: staged=" + (status.staged ? "yes" : "no"),
    "private-modes=" + (status.stageModeSafe && status.appModeSafe && status.portableModeSafe && status.compatibilityModeSafe ? "safe" : "check"),
    "portable-manifest=" + (status.portableValid ? "ok" : "invalid"),
    "compat-manifest=" + (status.compatibilityValid ? "ok" : "invalid"),
    "manifest-link=" + (status.portableValid ? "ok" : "missing"),
    "skills=" + status.skillCount,
    "binding=" + (status.bindingValid ? "present(redacted)" : status.bindingPresent ? "invalid(redacted)" : "missing"),
    "marketplace-declared=" + (status.marketplaceDeclared ? "yes" : "no"),
    "installed-cache=" + status.installedCacheCount,
  ].join("; "),
);

if (
  !status.staged ||
  !status.portableValid ||
  !status.compatibilityValid ||
  !status.skillsValid ||
  !status.bindingValid ||
  !status.stageModeSafe ||
  !status.appModeSafe ||
  !status.portableModeSafe ||
  !status.compatibilityModeSafe
) {
  console.error("openai-app: private package is not installation-ready; App ID remains redacted");
  process.exitCode = 2;
} else if (!status.marketplaceDeclared || status.installedCacheCount === 0) {
  console.log(
    "openai-app: portable package is installation-ready but staged only. Staging does not install or refresh ChatGPT. Native MCP Apps acceptance must run through the registered app/direct app context or an actually installed plugin package.",
  );
} else {
  console.log(
    "openai-app: a local marketplace declaration and cached MSO plugin install were detected on this machine; reload the client and start a new conversation before native MCP Apps acceptance.",
  );
}
