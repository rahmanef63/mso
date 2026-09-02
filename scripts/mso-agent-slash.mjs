import process from "node:process";
import {
  currentSkillProject,
  resolveSlashSkill,
  skillRuntimeState,
  slashSkillNames,
} from "./mso-agent-skills.mjs";

export const BUILTIN_SLASH_ITEMS = [
  { text: "/help", meta: "Show commands and shortcuts", kind: "command" },
  {
    text: "/models",
    meta: "Configure AI providers and authentication",
    kind: "command",
  },
  {
    text: "/model",
    meta: "Select the active model from connected providers",
    kind: "command",
  },
  { text: "/new", meta: "Create and switch to a fresh durable session", kind: "command" },
  { text: "/restart", meta: "Soft-reload runtime, skills, tools, and updated CLI code", kind: "command" },
  { text: "/session", meta: "Open the recent-session picker", kind: "command" },
  {
    text: "/resume",
    meta: "Resume a session; no arg opens the same picker",
    kind: "command",
  },
  { text: "/title", meta: "Rename the durable session", kind: "command" },
  {
    text: "/status",
    meta: "Show model, auth, context, tokens, session",
    kind: "command",
  },
  {
    text: "/permission",
    meta: "Choose ask, auto-write, or yolo approval mode",
    kind: "command",
  },
  {
    text: "/context",
    meta: "Show context/token/session status",
    kind: "command",
  },
  {
    text: "/statusbar",
    meta: "Toggle the compact dynamic status line",
    kind: "command",
  },
  { text: "/setup", meta: "Run full MSO onboarding", kind: "command" },
  {
    text: "/providers",
    meta: "Show infrastructure provider status",
    kind: "command",
  },
  {
    text: "/provider",
    meta: "Configure Dokploy, Cloudflare, or Hostinger",
    kind: "command",
  },
  { text: "/doctor", meta: "Run MSO diagnostics", kind: "command" },
  { text: "/tools", meta: "List available agent tools", kind: "command" },
  {
    text: "/agents",
    meta: "List live local session agents + registered remote A2A peers",
    kind: "command",
  },
  { text: "/message", meta: "Send a native local-session agent message", kind: "command" },
  {
    text: "/delegate",
    meta: "Queue a native local task; fall back to registered remote A2A peer",
    kind: "command",
  },
  {
    text: "/spawn",
    meta: "Run a foreground isolated subagent inside this session",
    kind: "command",
  },
  {
    text: "/inbox",
    meta: "Show native local-session agent inbox",
    kind: "command",
  },
  {
    text: "/skills",
    meta: "Browse and filter available skills",
    kind: "command",
  },
  {
    text: "/skill",
    meta: "Select a skill by exact catalog id",
    kind: "command",
  },
  { text: "/clear", meta: "Clear this session conversation", kind: "command" },
  { text: "/exit", meta: "Exit MSO Agent", kind: "command" },
  { text: "/quit", meta: "Alias for /exit", kind: "command" },
];

function skillItem(skillsData, name, cwd, session) {
  const { skill } = resolveSlashSkill(skillsData, name, cwd);
  if (!skill || skill.trust === "untrusted") return null;
  const scope = skill.project?.name
    ? `skill · ${skill.project.name}`
    : "skill · global";
  const description = String(skill.description || "")
    .replace(/[\r\n\t]+/g, " ")
    .trim();
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

export function slashCompletionItems(
  skillsData,
  input,
  cwd = process.cwd(),
  session = /** @type {any} */ (null),
) {
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
