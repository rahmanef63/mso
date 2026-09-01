#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import readline from "node:readline/promises";
import process from "node:process";
import { canonicalAgentApproval } from "../lib/agent/approval.mjs";
import {
  BASE, CLI, C, api, createCliSession, listCliSessions, loadCliSession,
  printBanner, saveCliSession, state, streamTurn,
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
    const answer = (await rl.question("  allow this exact call? [y/N]: ")).trim().toLowerCase();
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

async function agentRound(rl, session) {
  for (let turn = 0; turn < 10; turn++) {
    const result = await streamTurn(session.history, session.state.tools, session.agentSession);
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
}

function runCli(args) {
  const r = spawnSync(CLI, args, { stdio: "inherit", env: { ...process.env, MSO_BASE: BASE } });
  if (r.error) console.error(`${C.err}${r.error.message}${C.reset}`);
  return r.status ?? 1;
}

function sessionTitle(history) {
  const first = history.find((row) => row?.role === "user" && typeof row.text === "string" && row.text.trim());
  return first ? String(first.text).replace(/[\r\n\t]+/g, " ").trim().slice(0, 100) : undefined;
}

async function persist(session) {
  const saved = await saveCliSession(session.agentSession, session.history, sessionTitle(session.history));
  session.agentSession = { ...session.agentSession, ...saved };
}

function printSessions(rows) {
  if (!rows.length) { console.log("No MSO Agent sessions yet."); return; }
  console.log(`${C.bold}Recent MSO Agent sessions${C.reset}`);
  for (const row of rows) {
    const when = String(row.updatedAt || row.createdAt || "").replace("T", " ").slice(0, 19);
    const title = String(row.title || "MSO Agent session").replace(/[\r\n\t]+/g, " ").slice(0, 54);
    console.log(`  ${C.blue}${row.id}${C.reset}  ${C.dim}${when}${C.reset}  ${title}`);
  }
  console.log(`${C.dim}Resume with /resume <session-id> or mso agent --resume <session-id>${C.reset}`);
}

async function resumeInto(session, id) {
  const loaded = await loadCliSession(id);
  if (!loaded || loaded.source !== "cli") throw new Error("session is not a CLI MSO Agent session");
  session.agentSession = loaded;
  session.history = Array.isArray(loaded.history) ? loaded.history.slice(-48) : [];
  console.log(`${C.c}resumed ${loaded.id}${C.reset} · ${loaded.title || "MSO Agent session"}`);
}

async function slash(line, session) {
  const [cmd, ...args] = line.trim().split(/\s+/);
  switch (cmd) {
    case "/help":
      console.log([
        "  /session                show current durable MSO session id",
        "  /sessions               list recent resumable sessions",
        "  /resume <id>            resume an earlier CLI MSO session",
        "  /model                  connect/change AI provider",
        "  /setup                  full MSO onboarding",
        "  /providers              infrastructure provider status",
        "  /provider <id>          configure dokploy|cloudflare|hostinger",
        "  /doctor                 run mso doctor",
        "  /tools                  list agent tools",
        "  /skills                 list available skills",
        "  /clear                  clear this session conversation",
        "  /exit                   quit",
      ].join("\n")); return "handled";
    case "/session":
      console.log(`${C.blue}${session.agentSession.id}${C.reset} · ${session.agentSession.title || "MSO Agent session"}`); return "handled";
    case "/sessions":
      printSessions(await listCliSessions(20)); return "handled";
    case "/resume":
      if (!args[0]) console.log("usage: /resume <session-id>");
      else await resumeInto(session, args[0]);
      return "handled";
    case "/model": runCli(["model"]); session.state = await state(); return "refresh";
    case "/setup": runCli(["onboard"]); session.state = await state(); return "refresh";
    case "/providers": runCli(["provider", "list"]); session.state = await state(); return "refresh";
    case "/provider": if (!args[0]) console.log("usage: /provider dokploy|cloudflare|hostinger"); else runCli(["provider", "set", args[0]]); session.state = await state(); return "refresh";
    case "/doctor": runCli(["doctor"]); return "handled";
    case "/tools": for (const tool of session.state.tools) console.log(`  ${String(tool.scope).padEnd(5)} ${tool.name}`); return "handled";
    case "/skills": for (const skill of session.state.skills?.skills ?? []) console.log(`  ${skill.id}${skill.description ? ` — ${skill.description}` : ""}`); return "handled";
    case "/clear": session.history = []; await persist(session); console.log("conversation cleared."); return "handled";
    case "/exit": return "exit";
    default: return "unknown";
  }
}

function resumeArg(argv) {
  const index = argv.indexOf("--resume");
  if (index < 0) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) throw new Error("--resume requires an MSO session id");
  return value;
}

async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error("mso agent needs an interactive terminal. For one-shot automation use: mso ai <prompt>");
    process.exit(2);
  }
  const requested = resumeArg(process.argv.slice(2));
  const [s, agentSession] = await Promise.all([
    state(),
    requested ? loadCliSession(requested) : createCliSession(),
  ]);
  if (!agentSession || agentSession.source !== "cli") throw new Error("could not establish a CLI MSO Agent session");
  printBanner(s, agentSession);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true, historySize: 100 });
  const session = {
    state: s,
    agentSession,
    history: Array.isArray(agentSession.history) ? agentSession.history.slice(-48) : [],
  };
  process.on("SIGINT", () => { console.log("\nUse /exit to quit."); });
  try {
    while (true) {
      let line = "";
      try { line = (await rl.question(`\n${C.blue}${C.bold}›${C.reset} `)).trim(); }
      catch { break; }
      if (!line) continue;
      if (line.startsWith("/")) {
        try {
          const result = await slash(line, session);
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
        await agentRound(rl, session);
        await persist(session);
      } catch (error) {
        console.error(`${C.err}agent error: ${error instanceof Error ? error.message : String(error)}${C.reset}`);
        await persist(session).catch(() => undefined);
      }
    }
  } finally {
    await persist(session).catch(() => undefined);
    rl.close();
  }
}

main().catch((error) => { console.error(`${C.err}mso agent: ${error instanceof Error ? error.message : String(error)}${C.reset}`); process.exit(1); });
