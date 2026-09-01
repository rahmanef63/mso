import { spawnSync } from "node:child_process";
import process from "node:process";
import { C, BASE, CLI, api, listCliSessions, state } from "./mso-agent-runtime.mjs";
import { loadSlashSkill, printSkillChoices, printSkills, resolveSlashSkill } from "./mso-agent-skills.mjs";
import { persistSession, printSessions, resumeInto, resumePicker } from "./mso-agent-session-ui.mjs";
import { printDetailedStatus } from "./mso-agent-status.mjs";

function runCli(args) {
  const result = spawnSync(CLI, args, { stdio: "inherit", env: { ...process.env, MSO_BASE: BASE } });
  if (result.error) console.error(`${C.err}${result.error.message}${C.reset}`);
  return result.status ?? 1;
}

async function selectSlashSkill(rl, session, requested, prompt, runTurn) {
  const resolved = resolveSlashSkill(session.state.skills, requested, process.cwd());
  if (!resolved.skill) {
    printSkillChoices(resolved.ambiguous, C);
    return resolved.ambiguous?.length ? "handled" : "unknown";
  }
  const loaded = await loadSlashSkill(api, session.agentSession.id, resolved.skill);
  const scope = loaded.project?.name ? `project ${loaded.project.name}` : "global";
  if (!prompt.trim()) {
    session.pendingSkill = loaded;
    console.log(`${C.warn}${C.bold}◆ /${loaded.name} queued${C.reset}${C.dim} · next message · ${scope}${C.reset}`);
    return "handled";
  }
  session.history.push({ role: "user", text: prompt.trim() });
  if (session.history.length > 48) session.history.splice(0, session.history.length - 48);
  await runTurn(loaded);
  return "handled";
}

function printHelp() {
  console.log([
    "  /session                show current durable MSO session id",
    "  /sessions               list recent resumable sessions",
    "  /resume [query]         resume latest/index/id/title; no arg opens picker",
    "  /title <name>           rename the durable session",
    "  /status                 model/auth/context/token/session details",
    "  /context                alias for /status",
    "  /statusbar [on|off]     toggle compact dynamic status line",
    "  /models [args]          configure AI providers/auth",
    "  /model [ref]            select active model from connected providers",
    "  /setup                  full MSO onboarding",
    "  /providers              infrastructure provider status",
    "  /provider <id>          configure dokploy|cloudflare|hostinger",
    "  /doctor                 run mso doctor",
    "  /tools                  list agent tools",
    "  /skills [query]         browse available slash skills",
    "  /skill <id> [prompt]    select exact skill id (ambiguity escape hatch)",
    "  /<skill> [prompt]       select for next message, or run prompt now",
    "  /clear                  clear this session conversation",
    "  /exit, /quit            quit",
    "",
    "Keyboard",
    "  Ctrl+C                  clear input; empty prompt exits; active turn interrupts",
    "  Ctrl+D                  delete right; empty prompt exits",
    "  Ctrl+L                  clear/repaint terminal",
    "  Ctrl+W                  delete previous word",
    "  ↑/↓ or Ctrl+P/N         command history",
    "  Ctrl+A/E · Ctrl+B/F     line start/end · left/right",
  ].join("\n"));
}

export async function handleSlash(rl, line, session, { runTurn }) {
  const [cmd, ...args] = line.trim().split(/\s+/);
  switch (cmd) {
    case "/help": printHelp(); return "handled";
    case "/session":
      console.log(`${C.blue}${session.agentSession.id}${C.reset} · ${session.agentSession.title || "MSO Agent session"}`); return "handled";
    case "/sessions":
      printSessions(await listCliSessions(50)); return "handled";
    case "/resume":
      if (!args.length) await resumePicker(rl, session); else await resumeInto(session, args.join(" "));
      return "refresh";
    case "/title": {
      const title = args.join(" ").trim();
      if (!title) console.log("usage: /title <session name>");
      else { session.titleOverride = title.slice(0, 120); await persistSession(session); console.log(`${C.c}✓ session title: ${session.titleOverride}${C.reset}`); }
      return "handled";
    }
    case "/status": case "/context": printDetailedStatus(session, C); return "handled";
    case "/statusbar": {
      const value = String(args[0] || "").toLowerCase();
      if (value === "off") session.statusBar = false; else if (value === "on") session.statusBar = true; else session.statusBar = !session.statusBar;
      console.log(`status bar ${session.statusBar ? "on" : "off"}`); return "handled";
    }
    case "/models": runCli(["models", ...args]); session.state = await state(); return "refresh";
    case "/model": runCli(["model", ...args]); session.state = await state(); return "refresh";
    case "/setup": runCli(["onboard"]); session.state = await state(); return "refresh";
    case "/providers": runCli(["provider", "list"]); session.state = await state(); return "refresh";
    case "/provider":
      if (!args[0]) console.log("usage: /provider dokploy|cloudflare|hostinger"); else runCli(["provider", "set", args[0]]);
      session.state = await state(); return "refresh";
    case "/doctor": runCli(["doctor"]); return "handled";
    case "/tools": for (const tool of session.state.tools) console.log(`  ${String(tool.scope).padEnd(5)} ${tool.name}`); return "handled";
    case "/skills": printSkills(session, C, args.join(" ")); return "handled";
    case "/skill":
      if (!args[0]) { console.log("usage: /skill <name-or-exact-id> [prompt]"); return "handled"; }
      return selectSlashSkill(rl, session, args[0], args.slice(1).join(" "), runTurn);
    case "/clear":
      Object.assign(session, { history: [], pendingSkill: null, activeSkill: null, lastInvokedSkill: null });
      await persistSession(session); console.log("conversation cleared."); return "handled";
    case "/exit": case "/quit": return "exit";
    default: return selectSlashSkill(rl, session, cmd.slice(1), args.join(" "), runTurn);
  }
}
