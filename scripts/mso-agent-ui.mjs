import process from "node:process";

const color = process.stdout.isTTY && !process.env.NO_COLOR;
export const C = {
  reset: color ? "\x1b[0m" : "", bold: color ? "\x1b[1m" : "", dim: color ? "\x1b[2m" : "",
  blue: color ? "\x1b[38;2;58;160;255m" : "", cyan: color ? "\x1b[38;2;52;211;153m" : "",
  warn: color ? "\x1b[38;2;245;158;11m" : "", err: color ? "\x1b[38;2;239;68;68m" : "",
};
C.a = C.blue;
C.b = C.blue;
C.c = C.cyan;

export const MSO_TITLE_GUTTER = "  ";

export const MSO_TITLE_ART = [
  "  ████████████",
  "  ██          ██",
  "  ██   ██ ██ ██   ██████████████████████",
  "  ██                                  ██      ███╗   ███╗███████╗ ██████╗ ",
  "  ██                                  ██      ████╗ ████║██╔════╝██╔═══██╗",
  "  ██       ██                ██       ██      ██╔████╔██║███████╗██║   ██║",
  "  ██         ██                ██     ██      ██║╚██╔╝██║╚════██║██║   ██║",
  "  ██       ██    ████████    ██       ██      ██║ ╚═╝ ██║███████║╚██████╔╝",
  "  ██                                  ██      ╚═╝     ╚═╝╚══════╝ ╚═════╝ ",
  "  ██                                  ██",
  "   ████████████████████████████████████",
  "                                                       ── MSO Agent ──",
];

function plain(value) { return String(value ?? "").replace(/\x1b\[[0-9;]*m/g, ""); }
function width(value) { return [...plain(value)].length; }
export function fit(value, max) {
  const source = plain(value).replace(/[\r\n\t]+/g, " ");
  if (max <= 0) return "";
  if ([...source].length <= max) return source;
  if (max <= 1) return "…".slice(0, max);
  return [...source].slice(0, max - 1).join("") + "…";
}
function pad(value, max) {
  const clean = fit(value, max);
  return clean + " ".repeat(Math.max(0, max - width(clean)));
}
function rule(char, n) { return char.repeat(Math.max(0, n)); }
function terminalWidth() {
  const cols = Number(process.stdout.columns || 104);
  return Math.max(72, Math.min(118, cols - 2));
}
function countSkills(data) { return Array.isArray(data?.skills) ? data.skills.length : 0; }
function summarizeInfra(data) {
  const rows = Array.isArray(data?.providers) ? data.providers : [];
  const ready = rows.filter((row) => row.configured).map((row) => String(row.id));
  return { ready, total: rows.length };
}
function toolCategory(name) {
  if (/^fs_/.test(name)) return "files";
  if (/^(sys_|apps_|browser_)/.test(name)) return "system";
  if (/^(project|projects)_/.test(name)) return "projects";
  if (/^(workflow_|skills_|agent_)/.test(name)) return "agent";
  if (/^(dokploy_|cloudflare_|hostinger_|infra_)/.test(name)) return "infra";
  return "other";
}
function groupedToolLines(tools, maxLines = 5) {
  const order = ["files", "system", "projects", "agent", "infra", "other"];
  const groups = new Map(order.map((key) => [key, []]));
  for (const tool of tools) groups.get(toolCategory(String(tool.name)))?.push(String(tool.name));
  return order.filter((key) => groups.get(key)?.length).slice(0, maxLines).map((key) => ({
    label: key, value: groups.get(key).join(", "),
  }));
}
function groupedSkillLines(skills, maxLines = 5) {
  const rows = Array.isArray(skills) ? skills : [];
  const groups = new Map();
  for (const skill of rows) {
    const label = String(skill.category || skill.source || "skills").replace(/^mso[:/ -]?/i, "") || "skills";
    if (!groups.has(label)) groups.set(label, []);
    const name = String(skill.id || skill.name || "");
    if (name) groups.get(label).push(name);
  }
  return [...groups.entries()].slice(0, maxLines).map(([label, names]) => ({ label, value: names.join(", ") }));
}
function kv(label, value, widthLimit) {
  const labelWidth = Math.min(13, Math.max(8, widthLimit > 36 ? 12 : 9));
  return `${pad(label, labelWidth)} ${fit(value, Math.max(0, widthLimit - labelWidth - 1))}`;
}
function panelLine(left, right, leftWidth, rightWidth, gap = 3) {
  return `│ ${pad(left, leftWidth)}${" ".repeat(gap)}${pad(right, rightWidth)} │`;
}
function panelSingle(text, inner) { return `│ ${pad(text, inner)} │`; }
function panelTitle(title, inner) {
  const label = ` ${title} `;
  const remaining = Math.max(0, inner - width(label));
  const before = Math.floor(remaining / 2);
  return `┌${rule("─", before)}${label}${rule("─", remaining - before)}┐`;
}

export function printAgentBanner(s, agentSession, { base, version }) {
  const totalWidth = terminalWidth();
  const inner = totalWidth - 2;
  const titleArtWidth = width(MSO_TITLE_GUTTER) + Math.max(...MSO_TITLE_ART.map(width));
  if (totalWidth >= titleArtWidth) {
    for (const line of MSO_TITLE_ART) console.log(`${C.blue}${C.bold}${MSO_TITLE_GUTTER}${line}${C.reset}`);
  } else console.log(`${C.blue}${C.bold}── MSO Agent ──${C.reset}`);
  console.log();

  const byScope = { read: 0, write: 0, exec: 0 };
  for (const tool of s.tools) byScope[tool.scope] = (byScope[tool.scope] || 0) + 1;
  const infra = summarizeInfra(s.infra);
  const tools = groupedToolLines(s.tools, 5);
  const skills = groupedSkillLines(s.skills?.skills, 5);
  const model = `${s.config?.provider ?? "—"}/${s.config?.model ?? "—"}`;
  const sessionId = agentSession?.id || "—";
  const title = `MSO Agent${version ? ` v${version}` : ""} · ${sessionId}`;

  console.log(panelTitle(title, inner));
  if (totalWidth >= 94) {
    const gap = 4;
    const leftWidth = Math.max(30, Math.floor((inner - gap) * 0.37));
    const rightWidth = inner - gap - leftWidth;
    const left = [
      `${C.bold}Runtime${C.reset}`, kv("model", model, leftWidth), kv("session", sessionId, leftWidth),
      kv("endpoint", base, leftWidth), "", `${C.bold}Capabilities${C.reset}`,
      fit(`${byScope.read} read · ${byScope.write} write · ${byScope.exec} exec`, leftWidth),
      fit("write/exec approval-gated", leftWidth), "", `${C.bold}Infrastructure${C.reset}`,
      fit(`${infra.ready.length}/${infra.total} ready`, leftWidth),
      fit(infra.ready.length ? infra.ready.join(" · ") : "run /providers to connect", leftWidth),
    ];
    const right = [`${C.bold}Available Tools${C.reset}`];
    for (const row of tools) right.push(kv(row.label, row.value, rightWidth));
    right.push("", `${C.bold}Available Skills${C.reset}`);
    for (const row of skills) right.push(kv(row.label, row.value, rightWidth));
    const rows = Math.max(left.length, right.length);
    for (let i = 0; i < rows; i++) console.log(panelLine(left[i] || "", right[i] || "", leftWidth, rightWidth, gap));
  } else {
    const lines = [
      `${C.bold}Runtime${C.reset}`, kv("model", model, inner), kv("session", sessionId, inner), kv("endpoint", base, inner), "",
      `${C.bold}Available Tools${C.reset}`, ...tools.map((row) => kv(row.label, row.value, inner)), "",
      `${C.bold}Available Skills${C.reset}`, ...skills.map((row) => kv(row.label, row.value, inner)), "",
      `${C.bold}Capabilities${C.reset}`, `${byScope.read} read · ${byScope.write} write · ${byScope.exec} exec · write/exec approval-gated`,
      `${C.bold}Infrastructure${C.reset}`, `${infra.ready.length}/${infra.total} ready · ${infra.ready.length ? infra.ready.join(" · ") : "run /providers to connect"}`,
    ];
    for (const line of lines) console.log(panelSingle(line, inner));
  }
  console.log(`└${rule("─", inner)}┘`);
  console.log(`${C.dim}${s.tools.length} tools · ${countSkills(s.skills)} skills · /skills · /<skill> · /help${C.reset}`);
  console.log();
  console.log(`${C.bold}Welcome to MSO Agent!${C.reset} Type your message or /help for commands.`);
}
