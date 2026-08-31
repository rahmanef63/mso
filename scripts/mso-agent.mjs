#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import readline from "node:readline/promises";
import process from "node:process";
import { canonicalAgentApproval } from "../lib/agent/approval.js";
import { BASE, CLI, C, api, printBanner, state, streamTurn } from "./mso-agent-runtime.mjs";

async function executeTool(rl, tool, call) {
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

async function agentRound(rl, history, tools) {
  for (let turn = 0; turn < 10; turn++) {
    const result = await streamTurn(history, tools);
    history.push({ role: "assistant", text: result.text, toolUses: result.toolUses });
    if (!result.toolUses.length) return;
    const results = [];
    for (const call of result.toolUses) {
      const tool = tools.find((row) => row.name === call.name);
      const outcome = await executeTool(rl, tool, call);
      results.push({ id: call.id, content: outcome.result, isError: !outcome.ok });
    }
    history.push({ role: "tool", results });
  }
  console.log(`${C.warn}turn limit reached; ask to continue if needed.${C.reset}`);
}

function runCli(args) {
  const r = spawnSync(CLI, args, { stdio: "inherit", env: { ...process.env, MSO_BASE: BASE } });
  if (r.error) console.error(`${C.err}${r.error.message}${C.reset}`);
  return r.status ?? 1;
}

async function slash(line, rl, session) {
  const [cmd, ...args] = line.trim().split(/\s+/);
  switch (cmd) {
    case "/help":
      console.log("  /model                 connect/change AI provider\n  /setup                 full MSO onboarding\n  /providers             infrastructure provider status\n  /provider <id>         configure dokploy|cloudflare|hostinger\n  /doctor                run mso doctor\n  /tools                 list agent tools\n  /skills                list available skills\n  /clear                 clear this conversation\n  /exit                  quit"); return "handled";
    case "/model": runCli(["model"]); session.state = await state(); return "refresh";
    case "/setup": runCli(["onboard"]); session.state = await state(); return "refresh";
    case "/providers": runCli(["provider", "list"]); session.state = await state(); return "refresh";
    case "/provider": if (!args[0]) console.log("usage: /provider dokploy|cloudflare|hostinger"); else runCli(["provider", "set", args[0]]); session.state = await state(); return "refresh";
    case "/doctor": runCli(["doctor"]); return "handled";
    case "/tools": for (const tool of session.state.tools) console.log(`  ${String(tool.scope).padEnd(5)} ${tool.name}`); return "handled";
    case "/skills": for (const skill of session.state.skills?.skills ?? []) console.log(`  ${skill.id}${skill.description ? ` — ${skill.description}` : ""}`); return "handled";
    case "/clear": session.history.length = 0; console.log("conversation cleared."); return "handled";
    case "/exit": return "exit";
    default: return "unknown";
  }
}

async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error("mso agent needs an interactive terminal. For one-shot automation use: mso ai <prompt>");
    process.exit(2);
  }
  let s = await state();
  printBanner(s);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true, historySize: 100 });
  const session = { state: s, history: [] };
  process.on("SIGINT", () => { console.log("\nUse /exit to quit."); });
  try {
    while (true) {
      let line = "";
      try { line = (await rl.question(`\n${C.a}${C.bold}›${C.reset} `)).trim(); }
      catch { break; }
      if (!line) continue;
      if (line.startsWith("/")) {
        const result = await slash(line, rl, session);
        if (result === "exit") break;
        if (result === "unknown") console.log("unknown command; /help lists commands.");
        continue;
      }
      session.history.push({ role: "user", text: line });
      if (session.history.length > 36) session.history.splice(0, session.history.length - 36);
      try { await agentRound(rl, session.history, session.state.tools); }
      catch (error) { console.error(`${C.err}agent error: ${error instanceof Error ? error.message : String(error)}${C.reset}`); }
    }
  } finally { rl.close(); }
}

main().catch((error) => { console.error(`${C.err}mso agent: ${error instanceof Error ? error.message : String(error)}${C.reset}`); process.exit(1); });
