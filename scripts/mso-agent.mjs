#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import process from "node:process";
import { canonicalAgentApproval } from "../lib/agent/approval.mjs";
import { beginSkillInvocation, endSkillInvocation, loadSlashSkill, printSkillChoices, printSkills, resolveSlashSkill } from "./mso-agent-skills.mjs";
import { AgentComposer } from "./mso-agent-composer.mjs";
import { slashCompletionItems } from "./mso-agent-slash.mjs";
import { addUsage, printDetailedStatus, renderStatusBar } from "./mso-agent-status.mjs";
import { persistSession, printSessions, resumeArg, resumeInto, resumePicker, startupSession } from "./mso-agent-session-ui.mjs";
import {
  BASE, CLI, C, api, listCliSessions, printBanner, state, streamTurn,
} from "./mso-agent-runtime.mjs";

async function executeTool(rl, tool, call, agentSession) {
  if (!tool) return { ok: false, result: `unknown tool requested by model: ${call.name}` };
  let approved = tool.scope === "read";
  let approval = null;
  if (!approved) {
    try {
      approval = canonicalAgentApproval(tool.name, call.input || {});
    } catch (error) {
      return { ok: false, result: `cannot safely approve tool call: ${error instanceof Error ? error.message : String(error)}` };
    }
    console.log(`${C.warn}${C.bold}[${tool.scope.toUpperCase()}] exact tool call${C.reset}`);
    console.log(approval.display);
    console.log(`${C.dim}sha256 ${approval.digest} · ${approval.bytes} bytes${C.reset}`);
    const answer = String(await rl.question("  allow this exact call? [y/N]: ", { history: false }) ?? "").trim().toLowerCase();
    if (answer === "y" || answer === "yes") approved = true;
  }
  if (!approved) return { ok: false, result: "denied by user" };
  process.stdout.write(`${C.dim}  ↳ ${tool.name}…${C.reset}`);
  try {
    const input = approval ? approval.payload.input : (call.input || {});
    const out = await api("/api/v1/agent-tools", {
      method: "POST",
      body: JSON.stringify({
        name: tool.name,
        input,
        sessionId: agentSession.id,
        ...(tool.scope === "read" ? {} : { approved: true, approvalDigest: approval.digest }),
      }),
    });
    process.stdout.write(`\r${C.c}  ✓ ${tool.name}${C.reset}\n`);
    if (!out.ok) return { ok: false, result: out.result || "tool failed" };
    return { ok: true, result: String(out.result ?? "ok") };
  } catch (error) {
    process.stdout.write(`\r${C.err}  ✗ ${tool.name}${C.reset}\n`);
    return { ok: false, result: (error instanceof Error ? error.message : String(error)).slice(0, 2000) };
  }
}

async function agentRound(rl, session, skillContext = null) {
  const startedAt = Date.now(); beginSkillInvocation(session, skillContext, C);
  try {
    for (let turn = 0; turn < 10; turn++) {
      const result = await streamTurn(session.history, session.state.tools, session.agentSession, skillContext); if (skillContext) session.lastInvokedSkill = skillContext;
      session.usage = addUsage(session.usage, result.usage);
      session.lastElapsedMs = Date.now() - startedAt;
      session.history.push({ role: "assistant", text: result.text, toolUses: result.toolUses });
      if (!result.toolUses.length) return;
      const results = [];
      for (const call of result.toolUses) {
        const tool = session.state.tools.find((row) => row.name === call.name);
        const outcome = await executeTool(rl, tool, call, session.agentSession);
        results.push({ id: call.id, content: outcome.result, isError: !outcome.ok });
      }
      session.history.push({ role: "tool", results });
    }
    console.log(`${C.warn}turn limit reached; ask to continue if needed.${C.reset}`);
  } finally {
    endSkillInvocation(session, skillContext);
  }
}

function runCli(args) {
  const r = spawnSync(CLI, args, { stdio: "inherit", env: { ...process.env, MSO_BASE: BASE } });
  if (r.error) console.error(`${C.err}${r.error.message}${C.reset}`);
  return r.status ?? 1;
}

async function selectSlashSkill(rl, session, requested, prompt = "") {
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
  await agentRound(rl, session, loaded);
  await persistSession(session);
  return "handled";
}

async function slash(rl, line, session) {
  const [cmd, ...args] = line.trim().split(/\s+/);
  switch (cmd) {
    case "/help":
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
        "  /exit                   quit",
      ].join("\n")); return "handled";
    case "/session":
      console.log(`${C.blue}${session.agentSession.id}${C.reset} · ${session.agentSession.title || "MSO Agent session"}`); return "handled";
    case "/sessions":
      printSessions(await listCliSessions(50)); return "handled";
    case "/resume":
      if (!args.length) await resumePicker(rl, session);
      else await resumeInto(session, args.join(" "));
      return "refresh";
    case "/title": {
      const title = args.join(" ").trim();
      if (!title) console.log("usage: /title <session name>");
      else { session.titleOverride = title.slice(0, 120); await persistSession(session); console.log(`${C.c}✓ session title: ${session.titleOverride}${C.reset}`); }
      return "handled";
    }
    case "/status": case "/context": printDetailedStatus(session, C); return "handled";
    case "/statusbar": {
      const v = String(args[0] || "").toLowerCase();
      if (v === "off") session.statusBar = false; else if (v === "on") session.statusBar = true;
      else session.statusBar = !session.statusBar;
      console.log(`status bar ${session.statusBar ? "on" : "off"}`); return "handled";
    }
    case "/models": runCli(["models", ...args]); session.state = await state(); return "refresh";
    case "/model": runCli(["model", ...args]); session.state = await state(); return "refresh";
    case "/setup": runCli(["onboard"]); session.state = await state(); return "refresh";
    case "/providers": runCli(["provider", "list"]); session.state = await state(); return "refresh";
    case "/provider": if (!args[0]) console.log("usage: /provider dokploy|cloudflare|hostinger"); else runCli(["provider", "set", args[0]]); session.state = await state(); return "refresh";
    case "/doctor": runCli(["doctor"]); return "handled";
    case "/tools": for (const tool of session.state.tools) console.log(`  ${String(tool.scope).padEnd(5)} ${tool.name}`); return "handled";
    case "/skills": printSkills(session, C, args.join(" ")); return "handled";
    case "/skill": if (!args[0]) { console.log("usage: /skill <name-or-exact-id> [prompt]"); return "handled"; } return selectSlashSkill(rl, session, args[0], args.slice(1).join(" "));
    case "/clear": Object.assign(session, { history: [], pendingSkill: null, activeSkill: null, lastInvokedSkill: null }); await persistSession(session); console.log("conversation cleared."); return "handled";
    case "/exit": return "exit";
    default: return selectSlashSkill(rl, session, cmd.slice(1), args.join(" "));
  }
}

async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error("mso agent needs an interactive terminal. For one-shot automation use: mso ai <prompt>");
    process.exit(2);
  }
  const requested = resumeArg(process.argv.slice(2));
  const [s, agentSession] = await Promise.all([
    state(),
    startupSession(requested),
  ]);
  if (!agentSession || agentSession.source !== "cli") throw new Error("could not establish a CLI MSO Agent session");
  printBanner(s, agentSession);
  const session = {
    state: s,
    agentSession,
    history: Array.isArray(agentSession.history) ? agentSession.history.slice(-48) : [],
    pendingSkill: null,
    activeSkill: null,
    lastInvokedSkill: null,
    titleOverride: requested ? (agentSession.title || null) : null,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    lastElapsedMs: 0,
    statusBar: true,
  };
  const rl = new AgentComposer({ input: process.stdin, output: process.stdout, colors: C });
  const completeSlash = (line) => slashCompletionItems(session.state.skills, line, process.cwd(), session);
  try {
    while (true) {
      let line = "";
      try {
        console.log();
        if (session.statusBar) console.log(renderStatusBar(session, C));
        const answer = await rl.question(`${C.blue}${C.bold}›${C.reset} `, { complete: completeSlash });
        if (answer === null) break;
        line = answer.trim();
      } catch { break; }
      if (!line) continue;
      if (line.startsWith("/")) {
        try {
          const result = await slash(rl, line, session);
          if (result === "exit") break;
          if (result === "unknown") console.log("unknown command; /help lists commands.");
        } catch (error) {
          console.error(`${C.err}${error instanceof Error ? error.message : String(error)}${C.reset}`);
        }
        continue;
      }
      session.history.push({ role: "user", text: line });
      if (session.history.length > 48) session.history.splice(0, session.history.length - 48);
      try {
        const skillContext = session.pendingSkill;
        session.pendingSkill = null;
        await agentRound(rl, session, skillContext);
        await persistSession(session);
      } catch (error) {
        console.error(`${C.err}agent error: ${error instanceof Error ? error.message : String(error)}${C.reset}`);
        await persistSession(session).catch(() => undefined);
      }
    }
  } finally {
    await persistSession(session).catch(() => undefined);
    console.log(`${C.dim}session ${session.agentSession.id} · resume: mso --continue  |  mso --resume ${session.agentSession.id}${C.reset}`);
    rl.close();
  }
}

main().catch((error) => { console.error(`${C.err}mso agent: ${error instanceof Error ? error.message : String(error)}${C.reset}`); process.exit(1); });
