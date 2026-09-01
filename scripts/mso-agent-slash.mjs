import process from "node:process";
import { currentSkillProject, resolveSlashSkill, skillRuntimeState, slashSkillNames } from "./mso-agent-skills.mjs";

export const BUILTIN_SLASH_ITEMS = [
  { text: "/help", meta: "Show commands and shortcuts", kind: "command" },
  { text: "/models", meta: "Configure AI providers and authentication", kind: "command" },
  { text: "/model", meta: "Select the active model from connected providers", kind: "command" },
  { text: "/session", meta: "Show the current durable session id", kind: "command" },
  { text: "/sessions", meta: "List resumable MSO Agent sessions", kind: "command" },
  { text: "/resume", meta: "Resume latest/index/id/title; no arg opens picker", kind: "command" },
  { text: "/title", meta: "Rename the durable session", kind: "command" },
  { text: "/status", meta: "Show model, auth, context, tokens, session", kind: "command" },
  { text: "/context", meta: "Show context/token/session status", kind: "command" },
  { text: "/statusbar", meta: "Toggle the compact dynamic status line", kind: "command" },
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

function skillItem(skillsData, name, cwd, session) {
  const { skill } = resolveSlashSkill(skillsData, name, cwd);
  if (!skill || skill.trust === "untrusted") return null;
  const scope = skill.project?.name ? `skill · ${skill.project.name}` : "skill · global";
  const description = String(skill.description || "").replace(/[\r\n\t]+/g, " ").trim();
  const state = skillRuntimeState(session, skill);
  return {
    text: `/${name}`,
    meta: `${state} · ${scope}${description ? ` — ${description}` : ""}`,
    kind: "skill",
    state,
    skillId: String(skill.id),
    project: skill.project || null,
  };
}

export function slashCompletionItems(skillsData, input, cwd = process.cwd(), session = /** @type {any} */ (null)) {
  const text = String(input || "").trimStart();
  if (!text.startsWith("/") || /\s/.test(text)) return [];
  const query = text.toLowerCase();
  const current = currentSkillProject(skillsData, cwd);
  const names = slashSkillNames(skillsData, cwd);
  const projectSkills = [];
  const globalSkills = [];
  for (const name of names) {
    const item = skillItem(skillsData, name, cwd, session);
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
