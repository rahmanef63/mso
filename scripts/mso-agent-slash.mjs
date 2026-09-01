import process from "node:process";
import { currentSkillProject, resolveSlashSkill, slashSkillNames } from "./mso-agent-skills.mjs";

export const BUILTIN_SLASH_ITEMS = [
  { text: "/help", meta: "Show commands and shortcuts", kind: "command" },
  { text: "/model", meta: "Connect or change the AI provider", kind: "command" },
  { text: "/session", meta: "Show the current durable session id", kind: "command" },
  { text: "/sessions", meta: "List resumable MSO Agent sessions", kind: "command" },
  { text: "/resume", meta: "Resume an earlier session by id", kind: "command" },
  { text: "/setup", meta: "Run full MSO onboarding", kind: "command" },
  { text: "/providers", meta: "Show infrastructure provider status", kind: "command" },
  { text: "/provider", meta: "Configure Dokploy, Cloudflare, or Hostinger", kind: "command" },
  { text: "/doctor", meta: "Run MSO diagnostics", kind: "command" },
  { text: "/tools", meta: "List available agent tools", kind: "command" },
  { text: "/skills", meta: "Browse and filter available skills", kind: "command" },
  { text: "/skill", meta: "Select a skill by exact catalog id", kind: "command" },
  { text: "/clear", meta: "Clear this session conversation", kind: "command" },
  { text: "/exit", meta: "Exit MSO Agent", kind: "command" },
];

function skillItem(skillsData, name, cwd) {
  const { skill } = resolveSlashSkill(skillsData, name, cwd);
  if (!skill || skill.trust === "untrusted") return null;
  const scope = skill.project?.name ? `skill · ${skill.project.name}` : "skill · global";
  const description = String(skill.description || "").replace(/[\r\n\t]+/g, " ").trim();
  return {
    text: `/${name}`,
    meta: `${scope}${description ? ` — ${description}` : ""}`,
    kind: "skill",
    project: skill.project || null,
  };
}

export function slashCompletionItems(skillsData, input, cwd = process.cwd()) {
  const text = String(input || "").trimStart();
  if (!text.startsWith("/") || /\s/.test(text)) return [];
  const query = text.toLowerCase();
  const current = currentSkillProject(skillsData, cwd);
  const names = slashSkillNames(skillsData, cwd);
  const projectSkills = [];
  const globalSkills = [];
  for (const name of names) {
    const item = skillItem(skillsData, name, cwd);
    if (!item) continue;
    if (current && item.project?.id === current.id) projectSkills.push(item);
    else globalSkills.push(item);
  }
  const builtinNames = new Set(BUILTIN_SLASH_ITEMS.map((item) => item.text));
  const all = [
    ...BUILTIN_SLASH_ITEMS,
    ...projectSkills.filter((item) => !builtinNames.has(item.text)),
    ...globalSkills.filter((item) => !builtinNames.has(item.text)),
  ];
  return all.filter((item) => item.text.toLowerCase().startsWith(query));
}
