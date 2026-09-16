#!/usr/bin/env bun
import { promises as fs } from "fs";
import path from "path";
import { parse as parseYaml } from "yaml";
import { validateSkillArtifact } from "../lib/skills/skill-artifact-validators.ts";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const argValue = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : fallback;
};
const repo = process.cwd();
const skillsRoot = path.resolve(repo, argValue("--root", "claude-skills"));
const templateRoot = path.resolve(repo, argValue("--template-root", "templates/mso-skill-flow"));
const skillTemplatePath = path.join(templateRoot, "SKILL.md.template");
const contractTemplatePath = path.join(templateRoot, "contract.yaml.template");
const openAiTemplatePath = path.join(templateRoot, "agents/openai.yaml.template");
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const errors = [];
const unquote = (value) => {
  const trimmed = value.trim();
  if (trimmed.startsWith('"')) {
    try { return JSON.parse(trimmed); } catch { return trimmed; }
  }
  return trimmed.replace(/^['"]|['"]$/g, "");
};

const skillTemplate = await fs.readFile(skillTemplatePath, "utf8").catch(() => "");
const contractTemplate = await fs.readFile(contractTemplatePath, "utf8").catch(() => "");
const openAiTemplate = await fs.readFile(openAiTemplatePath, "utf8").catch(() => "");
const skillTemplateTokens = [
  "{{NAME}}", "{{DESCRIPTION_YAML}}", "{{RISK}}", "{{POLICY}}", "{{TITLE}}",
  "{{USE_WHEN}}", "{{DO_NOT_USE}}", "{{REQUIRED_CONTEXT}}", "{{EXPECTED_STATE}}",
  "{{TARGETED_CHECKS}}", "{{RUNTIME_PROOF}}", "{{VISUAL_PROOF}}", "{{DIFF_BOUNDARY}}",
];
for (const token of skillTemplateTokens)
  if (!skillTemplate.includes(token)) errors.push(`SKILL template is missing ${token}`);
for (const token of ["{{USE_WHEN}}", "{{DO_NOT_USE}}", "{{TARGET}}", "{{RISK}}"])
  if (!contractTemplate.includes(token)) errors.push(`contract template is missing ${token}`);
for (const token of ["{{NAME}}", "{{TITLE}}", "{{OPENAI_SHORT_DESCRIPTION}}"])
  if (!openAiTemplate.includes(token)) errors.push(`OpenAI template is missing ${token}`);
for (const heading of ["## Trigger and boundaries", "## Fast route", "## Tool routing", "## Execution flow", "## Verification contract", "## Failure and rollback", "## Recipe memory"])
  if (!skillTemplate.includes(heading)) errors.push(`template is missing heading: ${heading}`);

const entries = (await fs.readdir(skillsRoot, { withFileTypes: true }).catch(() => []))
  .filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
let checked = 0;
for (const entry of entries) {
  const dir = path.join(skillsRoot, entry.name);
  const file = path.join(dir, "SKILL.md");
  const source = await fs.readFile(file, "utf8").catch(() => "");
  if (!source) continue;
  checked += 1;
  const parsed = /^---\n([\s\S]*?)\n---\n([\s\S]+)$/.exec(source);
  if (!parsed) { errors.push(`${entry.name}: invalid or missing YAML frontmatter`); continue; }
  const [, frontmatter, body] = parsed;
  const field = (name) => frontmatter.match(new RegExp(`^${name}:\\s*(.+)$`, "m"))?.[1];
  const nested = (name) => frontmatter.match(new RegExp(`^\\s{4}${name}:\\s*(.+)$`, "m"))?.[1];
  const name = field("name")?.trim();
  const description = field("description");
  const risk = nested("risk")?.trim();
  const policy = nested("policy")?.trim();
  if (name !== entry.name || !slug.test(name ?? "")) errors.push(`${entry.name}: frontmatter name must equal the kebab-case directory`);
  const plainDescription = description ? unquote(description) : "";
  if (plainDescription.length < 20 || plainDescription.length > 280) errors.push(`${entry.name}: description must be 20–280 characters`);
  if (!["low", "medium", "high"].includes(risk ?? "")) errors.push(`${entry.name}: metadata.mso.risk must be low, medium, or high`);
  if (!slug.test(policy ?? "")) errors.push(`${entry.name}: metadata.mso.policy must be kebab-case`);
  if (!body.includes(`# /${entry.name}`)) errors.push(`${entry.name}: H1 must begin with # /${entry.name}`);
  if (/{{[A-Z_]+}}/.test(source)) errors.push(`${entry.name}: unresolved SKILL template placeholder`);
  if (source.split("\n").length > 200) errors.push(`${entry.name}: exceeds the 200-line skill limit`);

  const contractPath = path.join(dir, "contract.yaml");
  const contractSource = await fs.readFile(contractPath, "utf8").catch(() => "");
  if (!contractSource) errors.push(`${entry.name}: missing contract.yaml`);
  else {
    if (/{{[A-Z_]+}}/.test(contractSource)) errors.push(`${entry.name}: unresolved contract template placeholder`);
    try {
      const raw = parseYaml(contractSource);
      const validated = validateSkillArtifact("skill-contract-v1", raw);
      if (!validated.ok) errors.push(...validated.errors.map((error) => `${entry.name}: contract ${error}`));
      else if (raw?.safety?.risk !== risk) errors.push(`${entry.name}: contract safety.risk must match metadata.mso.risk`);
    } catch (error) {
      errors.push(`${entry.name}: contract YAML parse failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const openAiPath = path.join(dir, "agents/openai.yaml");
  const openAiSource = await fs.readFile(openAiPath, "utf8").catch(() => "");
  if (!openAiSource) errors.push(`${entry.name}: missing agents/openai.yaml`);
  else {
    if (/{{[A-Z_]+}}/.test(openAiSource)) errors.push(`${entry.name}: unresolved OpenAI descriptor placeholder`);
    try {
      const raw = parseYaml(openAiSource);
      const validated = validateSkillArtifact("openai-skill-interface-v1", raw);
      if (!validated.ok) errors.push(...validated.errors.map((error) => `${entry.name}: OpenAI descriptor ${error}`));
      const prompt = raw?.interface?.default_prompt;
      if (typeof prompt === "string" && !prompt.includes(`$${entry.name}`)) errors.push(`${entry.name}: OpenAI default_prompt must reference $${entry.name}`);
    } catch (error) {
      errors.push(`${entry.name}: OpenAI descriptor YAML parse failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

const pluginPath = path.join(repo, ".codex-plugin/plugin.json");
try {
  const plugin = JSON.parse(await fs.readFile(pluginPath, "utf8"));
  const pkg = JSON.parse(await fs.readFile(path.join(repo, "package.json"), "utf8"));
  if (plugin.name !== "mso") errors.push(".codex-plugin/plugin.json name must be mso");
  if (plugin.version !== pkg.version) errors.push(".codex-plugin/plugin.json version must match package.json");
  if (plugin.skills !== "./claude-skills/") errors.push(".codex-plugin/plugin.json skills must point at ./claude-skills/");
  if (plugin.apps !== "./.app.json") errors.push(".codex-plugin/plugin.json apps must point at ./.app.json");
  if (plugin.mcpServers !== undefined) errors.push(".codex-plugin/plugin.json must not declare mcpServers; the web-capable MSO custom MCP app remains a separate OAuth connection");
  if (!Array.isArray(plugin.interface?.capabilities)) errors.push(".codex-plugin/plugin.json interface.capabilities must be an array");
  const appManifest = JSON.parse(await fs.readFile(path.join(repo, ".app.json"), "utf8"));
  if (!appManifest.apps || typeof appManifest.apps !== "object" || Array.isArray(appManifest.apps)) errors.push(".app.json must contain an apps object");
  for (const [name, app] of Object.entries(appManifest.apps ?? {})) {
    if (!slug.test(name)) errors.push(`.app.json app key must be kebab-case: ${name}`);
    if (!app || typeof app !== "object" || typeof app.id !== "string" || !/^(?:plugin_)?asdk_app_[a-z0-9]+$/.test(app.id)) errors.push(`.app.json ${name}.id must be an exact registered OpenAI app id`);
    if (app?.required !== true) errors.push(`.app.json ${name}.required must be true`);
  }
} catch (error) {
  errors.push(`OpenAI plugin manifest invalid: ${error instanceof Error ? error.message : String(error)}`);
}

if (!checked) errors.push(`no SKILL.md files found under ${skillsRoot}`);
if (errors.length) {
  console.error(errors.map((error) => `skill-flows: ${error}`).join("\n"));
  process.exit(1);
}
console.log(`skill-flows: ${checked} official skills valid; contracts + OpenAI descriptors + plugin manifest ready`);
