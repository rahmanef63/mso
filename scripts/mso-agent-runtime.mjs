import fs from "node:fs";
import process from "node:process";

export const BASE = String(process.env.MSO_AGENT_BASE || "http://127.0.0.1:4005").replace(/\/$/, "");
const ORIGIN = String(process.env.MSO_AGENT_ORIGIN || BASE);
const JAR = String(process.env.MSO_AGENT_JAR || "");
export const CLI = String(process.env.MSO_AGENT_CLI || "mso");
const VERSION = String(process.env.MSO_AGENT_VERSION || "");
const color = process.stdout.isTTY && !process.env.NO_COLOR;
export const C = {
  reset: color ? "\x1b[0m" : "", bold: color ? "\x1b[1m" : "", dim: color ? "\x1b[2m" : "",
  a: color ? "\x1b[38;2;124;92;255m" : "", b: color ? "\x1b[38;2;58;160;255m" : "", c: color ? "\x1b[38;2;52;211;153m" : "",
  warn: color ? "\x1b[38;2;245;158;11m" : "", err: color ? "\x1b[38;2;239;68;68m" : "",
};

function cookieHeader() {
  if (!JAR) return "";
  let raw = "";
  try { raw = fs.readFileSync(JAR, "utf8"); } catch { return ""; }
  const pairs = [];
  for (let line of raw.split(/\r?\n/)) {
    if (line.startsWith("#HttpOnly_")) line = line.slice("#HttpOnly_".length);
    else if (!line || line.startsWith("#")) continue;
    const cols = line.split("\t");
    if (cols.length >= 7 && cols[5] === "session") pairs.push(`session=${cols[6] ?? ""}`);
  }
  return pairs.join("; ");
}

export async function api(path, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("origin", ORIGIN);
  const cookie = cookieHeader();
  if (cookie) headers.set("cookie", cookie);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) throw new Error(typeof body === "object" && body?.error ? String(body.error) : `HTTP ${res.status}`);
  return body;
}

function logo() {
  const icon = [
    "   ╭──────╮          ",
    "╭──┘      ╰────────╮ ",
    "│                  │ ",
    "│      >_          │ ",
    "│                  │ ",
    "╰──────────────────╯ ",
  ];
  const wordmark = [
    "███╗   ███╗ ███████╗  ██████╗ ",
    "████╗ ████║ ██╔════╝ ██╔═══██╗",
    "██╔████╔██║ ███████╗ ██║   ██║",
    "██║╚██╔╝██║ ╚════██║ ██║   ██║",
    "██║ ╚═╝ ██║ ███████║ ╚██████╔╝",
    "╚═╝     ╚═╝ ╚══════╝  ╚═════╝ ",
  ];
  const narrow = Number(process.stdout.columns || 0) > 0 && process.stdout.columns < 72;
  const lines = narrow ? [...icon, "", ...wordmark] : wordmark.map((line, i) => `${icon[i]}  ${line}`);
  return lines.map((line, i) => {
    if (!line) return line;
    const phase = narrow ? i % 6 : i;
    return `${phase < 2 ? C.a : phase < 4 ? C.b : C.c}${C.bold}${line}${C.reset}`;
  }).join("\n");
}

function countSkills(data) { return Array.isArray(data?.skills) ? data.skills.length : 0; }
function summarizeInfra(data) {
  const rows = Array.isArray(data?.providers) ? data.providers : [];
  const ready = rows.filter((row) => row.configured).map((row) => row.id);
  return { ready, total: rows.length };
}

export async function state() {
  const [config, toolsData, skills, infra] = await Promise.all([
    api("/api/config"), api("/api/v1/agent-tools"), api("/api/skills").catch(() => ({ skills: [] })), api("/api/v1/infra/providers").catch(() => ({ providers: [] })),
  ]);
  const tools = Array.isArray(toolsData?.tools) ? toolsData.tools : [];
  return { config, toolsData, tools, skills, infra };
}

function compactNames(rows, max = 7) {
  const names = rows.map((row) => String(row.id ?? row.name ?? "")).filter(Boolean);
  return `${names.slice(0, max).join(", ")}${names.length > max ? `, +${names.length - max} more` : ""}` || "none";
}

export function printBanner(s) {
  const byScope = { read: 0, write: 0, exec: 0 };
  for (const tool of s.tools) byScope[tool.scope] = (byScope[tool.scope] || 0) + 1;
  const infra = summarizeInfra(s.infra);
  const readTools = s.tools.filter((tool) => tool.scope === "read");
  const gatedTools = s.tools.filter((tool) => tool.scope !== "read");
  const skills = Array.isArray(s.skills?.skills) ? s.skills.skills : [];
  console.log(logo());
  console.log();
  console.log(`${C.bold}╭─ MSO Agent${C.reset} ${C.dim}${VERSION ? `v${VERSION} · ` : ""}${BASE}${C.reset}`);
  console.log(`│ model          ${C.a}${s.config?.provider ?? "—"}/${s.config?.model ?? "—"}${C.reset}`);
  console.log(`│ capabilities   ${byScope.read} read · ${byScope.write} write · ${byScope.exec} exec ${C.dim}(write/exec approval-gated)${C.reset}`);
  console.log(`├─ ${C.bold}Available Tools${C.reset}`);
  console.log(`│ read           ${compactNames(readTools)}`);
  console.log(`│ approval       ${compactNames(gatedTools, 6)}`);
  console.log(`├─ ${C.bold}Available Skills${C.reset}`);
  console.log(`│ ${countSkills(s.skills)} loaded       ${compactNames(skills, 8)}`);
  console.log(`├─ ${C.bold}Infrastructure${C.reset}`);
  console.log(`│ ${infra.ready.length}/${infra.total} ready        ${infra.ready.length ? infra.ready.join(", ") : "run /providers to connect Dokploy/Cloudflare/Hostinger"}`);
  console.log(`╰─ ${C.dim}Ask MSO to inspect, configure, deploy, or debug this server. /help shows commands.${C.reset}`);
}

const SYSTEM = [
  "You are MSO Agent, the interactive terminal setup and operations agent for Manef Shell OS on the user's own server.",
  "Use the provided tools to do real work instead of only describing commands. Prefer bounded tools over exec_run.",
  "For setup, first inspect infrastructure with infra_providers_list and live-check configured providers with infra_provider_doctor.",
  "Dokploy, Cloudflare, and Hostinger credentials are entered interactively with `mso provider set <id>` and are never exposed to you; never ask the user to paste API tokens into chat or shell commands.",
  "Use dokploy_* and cloudflare_*/hostinger_* tools after the user has configured those providers. Cloudflare DNS must remain per-record and DNS-only unless the user explicitly asks for proxying.",
  "If multiple operational calls are needed, use workflow_start, pass its workflow_id to later calls, verify, then workflow_finish. If the task is abandoned, workflow_cancel.",
  "Write and exec tools may be denied by the user's approval prompt. Never retry a denied call unchanged.",
  "Be concise. Explain only decisions the user needs to make or concrete results/errors.",
].join(" ");

function toolForModel(tool) {
  return { name: tool.name, description: tool.description, input_schema: tool.inputSchema || { type: "object", properties: {} } };
}

export async function streamTurn(messages, tools) {
  const res = await fetch(`${BASE}/api/assistant`, {
    method: "POST",
    headers: { origin: ORIGIN, cookie: cookieHeader(), "content-type": "application/json" },
    body: JSON.stringify({ messages, tools: tools.map(toolForModel), system: SYSTEM }),
  });
  if (!res.ok || !res.body) {
    let body = {}; try { body = await res.json(); } catch {}
    throw new Error(body?.error || `assistant HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", text = "", stopReason = null;
  const toolUses = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const blocks = buf.split("\n\n"); buf = blocks.pop() || "";
    for (const block of blocks) {
      let event = "message", data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) continue;
      if (event === "delta") {
        const chunk = JSON.parse(data); text += chunk; process.stdout.write(chunk);
      } else if (event === "tool_use") toolUses.push(JSON.parse(data));
      else if (event === "done") stopReason = JSON.parse(data)?.stopReason ?? null;
      else if (event === "error") throw new Error(JSON.parse(data));
    }
  }
  if (text && !text.endsWith("\n")) process.stdout.write("\n");
  return { text, toolUses, stopReason };
}
