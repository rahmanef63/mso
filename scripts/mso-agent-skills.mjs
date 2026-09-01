import path from "node:path";
import process from "node:process";

function skillRows(skillsData) {
  return Array.isArray(skillsData?.skills) ? skillsData.skills : [];
}

function inside(root, cwd) {
  if (!root) return false;
  const rel = path.relative(path.resolve(root), path.resolve(cwd));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function currentSkillProject(skillsData, cwd = process.cwd()) {
  const projects = new Map();
  for (const skill of skillRows(skillsData)) {
    const project = skill?.project;
    if (!project?.id || !project?.path || !inside(project.path, cwd)) continue;
    projects.set(project.id, project);
  }
  return [...projects.values()].sort((a, b) => String(b.path).length - String(a.path).length)[0] || null;
}

export function resolveSlashSkill(skillsData, requested, cwd = process.cwd()) {
  const raw = String(requested || "").replace(/^\/+/, "").trim();
  if (!raw) return { skill: null, ambiguous: [] };
  const rows = skillRows(skillsData);

  // Exact catalog ids contain a slash for project skills. /skill <exact-id> is
  // the explicit escape hatch when the same skill name exists in many projects.
  if (raw.includes("/")) {
    const exact = rows.find((skill) => String(skill.id) === raw) || null;
    return { skill: exact, ambiguous: [] };
  }

  const named = rows.filter((skill) => String(skill.name || skill.id) === raw);
  const current = currentSkillProject(skillsData, cwd);
  if (current) {
    const local = named.filter((skill) => skill.project?.id === current.id);
    if (local.length === 1) return { skill: local[0], ambiguous: [], currentProject: current };
    if (local.length > 1) return { skill: null, ambiguous: local, currentProject: current };
  }

  const globals = named.filter((skill) => !skill.project);
  if (globals.length === 1) return { skill: globals[0], ambiguous: [], currentProject: current };
  if (globals.length > 1) return { skill: null, ambiguous: globals, currentProject: current };

  // Never silently import a project skill from some other repository just because
  // its name happens to be globally unique. Require an exact catalog id instead.
  return { skill: null, ambiguous: named, currentProject: current };
}

export function slashSkillNames(skillsData, cwd = process.cwd()) {
  const names = [...new Set(skillRows(skillsData)
    .filter((skill) => skill?.trust !== "untrusted")
    .map((skill) => String(skill.name || "").trim())
    .filter(Boolean))];
  return names.filter((name) => Boolean(resolveSlashSkill(skillsData, name, cwd).skill)).sort();
}

export async function loadSlashSkill(api, sessionId, skill) {
  if (!skill?.id) throw new Error("skill has no catalog id");
  const out = await api("/api/v1/agent-tools", {
    method: "POST",
    body: JSON.stringify({ name: "skills_read", input: { name: skill.id }, sessionId }),
  });
  if (!out?.ok) throw new Error(String(out?.result || `could not read skill ${skill.id}`));
  let data;
  try { data = JSON.parse(String(out.result || "{}")); }
  catch { throw new Error(`skill ${skill.id} returned an invalid read payload`); }
  if (data.instructionsWithheld) {
    throw new Error(`/${skill.name || skill.id} is not executable yet (${data.reason || `trust=${data.trust || skill.trust || "untrusted"}`})`);
  }
  if (!data.content) throw new Error(`skill ${skill.id} has no readable instructions`);
  return {
    id: String(data.id || skill.id),
    name: String(data.name || skill.name || skill.id),
    description: String(data.description || skill.description || ""),
    trust: String(data.trust || skill.trust || ""),
    project: data.project || skill.project || null,
    content: String(data.content),
  };
}


export function printSkillChoices(rows, C) {
  if (!rows?.length) return;
  console.log(`${C.warn}skill name is project-specific or ambiguous; choose one exact id:${C.reset}`);
  for (const skill of rows.slice(0, 20)) {
    const project = skill.project?.name ? ` · ${skill.project.name}` : " · global";
    console.log(`  /skill ${skill.id}${project}`);
  }
}

export function printSkills(session, C, query = "", cwd = process.cwd()) {
  const all = skillRows(session.state.skills);
  const q = query.trim().toLowerCase();
  const current = currentSkillProject(session.state.skills, cwd);
  const scoped = all.filter((skill) => !skill.project || (current && skill.project?.id === current.id));
  let rows = q
    ? all.filter((skill) => `${skill.name || ""} ${skill.id || ""} ${skill.description || ""}`.toLowerCase().includes(q))
    : scoped;
  rows = rows.slice().sort((a, b) => {
    const ap = current && a.project?.id === current.id ? 0 : a.project ? 2 : 1;
    const bp = current && b.project?.id === current.id ? 0 : b.project ? 2 : 1;
    return ap - bp || String(a.name || a.id).localeCompare(String(b.name || b.id));
  });
  if (current) console.log(`${C.bold}Current project skills:${C.reset} ${current.name} · ${current.path}`);
  const visible = rows.slice(0, 80);
  for (const skill of visible) {
    const scope = skill.project?.name ? `project:${skill.project.name}` : "global";
    const trust = skill.trust === "untrusted" ? `${C.warn}untrusted${C.reset}` : skill.trust || "";
    const description = skill.description
      ? ` — ${String(skill.description).replace(/[\r\n\t]+/g, " ").slice(0, 120)}`
      : "";
    console.log(`  ${C.blue}/${skill.name}${C.reset}  ${C.dim}${scope}${trust ? ` · ${trust}` : ""}${C.reset}${description}`);
  }
  if (rows.length > visible.length) console.log(`${C.dim}… ${rows.length - visible.length} more; refine with /skills <query>${C.reset}`);
  console.log(`${C.dim}Use /<skill> [prompt], or /skill <exact-id> [prompt] for an ambiguous project skill.${C.reset}`);
}

export const BUILTIN_SLASH = [
  "/help", "/session", "/sessions", "/resume", "/model", "/setup", "/providers", "/provider",
  "/doctor", "/tools", "/skills", "/skill", "/clear", "/exit",
];

export function slashCompleter(line, session) {
  const text = String(line || "");
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("/") || /\s/.test(trimmed)) return [[], text];
  const dynamic = slashSkillNames(session.state.skills).map((name) => `/${name}`);
  const all = [...new Set([...BUILTIN_SLASH, ...dynamic])];
  const hits = all.filter((item) => item.startsWith(trimmed)).sort();
  return [hits.length ? hits : all, trimmed];
}
