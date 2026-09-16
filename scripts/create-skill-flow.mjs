#!/usr/bin/env node
import { promises as fs } from "fs";
import path from "path";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const value = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const has = (flag) => args.includes(flag);
const fail = (message) => { console.error(`skill:new: ${message}`); process.exit(1); };
const usage = () => console.log(`Usage:
  bun run skill:new -- --name <slug> --description <text> [options]

Options:
  --title <heading>          Human title; defaults from the slug
  --risk low|medium|high     Default: medium
  --policy <slug>            Default: inspect-execute-verify
  --target <slug>            Structured contract target; defaults to skill name
  --openai-short <text>      OpenAI short description; defaults from --description
  --root <directory>         Default: claude-skills
`);

if (has("--help") || has("-h")) { usage(); process.exit(0); }
const name = value("--name")?.trim();
const description = value("--description")?.trim();
const risk = value("--risk")?.trim() ?? "medium";
const policy = value("--policy")?.trim() ?? "inspect-execute-verify";
const root = value("--root")?.trim() ?? "claude-skills";
const title = value("--title")?.trim() ?? name?.split("-").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ");
const targetName = value("--target")?.trim() ?? name;
const openAiShort = value("--openai-short")?.trim() ?? description?.slice(0, 100);

if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) fail("--name must be a lowercase kebab-case slug");
if (!description || description.length < 20 || description.length > 280 || /[\r\n]/.test(description)) fail("--description must be one line and 20–280 characters");
if (!["low", "medium", "high"].includes(risk)) fail("--risk must be low, medium, or high");
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(policy)) fail("--policy must be a lowercase kebab-case slug");
if (!targetName || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(targetName)) fail("--target must be a lowercase kebab-case slug");
if (!title || /[\r\n]/.test(title)) fail("--title must be one line");
if (!openAiShort || openAiShort.length > 120 || /[\r\n]/.test(openAiShort)) fail("--openai-short must be one line and at most 120 characters");

const repo = process.cwd();
const templateRoot = path.join(repo, "templates/mso-skill-flow");
const targetDir = path.resolve(repo, root, name);
const outputs = [
  { template: path.join(templateRoot, "SKILL.md.template"), target: path.join(targetDir, "SKILL.md") },
  { template: path.join(templateRoot, "contract.yaml.template"), target: path.join(targetDir, "contract.yaml") },
  { template: path.join(templateRoot, "agents/openai.yaml.template"), target: path.join(targetDir, "agents/openai.yaml") },
];
for (const row of outputs) {
  const exists = await fs.stat(row.target).then(() => true).catch(() => false);
  if (exists) fail(`${row.target} already exists; edit it intentionally instead of regenerating`);
}
const replacements = new Map([
  ["{{NAME}}", name], ["{{DESCRIPTION_YAML}}", JSON.stringify(description)], ["{{RISK}}", risk], ["{{POLICY}}", policy],
  ["{{TITLE}}", title], ["{{TARGET}}", targetName], ["{{OPENAI_SHORT_DESCRIPTION}}", openAiShort],
]);
await fs.mkdir(path.join(targetDir, "agents"), { recursive: true });
for (const row of outputs) {
  let content = await fs.readFile(row.template, "utf8").catch(() => fail(`missing template: ${row.template}`));
  for (const [from, to] of replacements) content = content.replaceAll(from, to);
  await fs.writeFile(row.target, content, { encoding: "utf8", flag: "wx" });
  console.log(`skill:new: created ${path.relative(repo, row.target)}`);
}
console.log("next: replace every remaining {{...}} guidance placeholder in SKILL.md/contract.yaml; skill:check intentionally fails until the workflow is specific");
console.log("then run `bun run skill:check`, targeted tests, and project verification");
