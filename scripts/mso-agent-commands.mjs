import { spawnSync } from "node:child_process";
import process from "node:process";
import { C } from "./mso-agent-runtime.mjs";
import { BASE, CLI, api, state } from "./mso-agent-api.mjs";
import {
  loadSlashSkill,
  printSkillChoices,
  printSkills,
  resolveSlashSkill,
} from "./mso-agent-skills.mjs";
import {
  persistSession,
  renameCurrentSession,
  renameCurrentSessionName,
  resumeInto,
  startNewSession,
  resumePicker,
} from "./mso-agent-session-ui.mjs";
import { printDetailedStatus } from "./mso-agent-status.mjs";
import {
  permissionCompletionItems,
  permissionMode,
} from "./mso-agent-permissions.mjs";
import { handleLocalCommand } from "./mso-agent-local-commands.mjs";
import { printHelp } from "./mso-agent-help.mjs";

function runCli(args) {
  const result = spawnSync(CLI, args, {
    stdio: "inherit",
    env: { ...process.env, MSO_BASE: BASE },
  });
  if (result.error) console.error(`${C.err}${result.error.message}${C.reset}`);
  return result.status ?? 1;
}

async function selectSlashSkill(rl, session, requested, prompt, runTurn) {
  const resolved = resolveSlashSkill(
    session.state.skills,
    requested,
    process.cwd(),
  );
  if (!resolved.skill) {
    printSkillChoices(resolved.ambiguous, C);
    return resolved.ambiguous?.length ? "handled" : "unknown";
  }
  const loaded = await loadSlashSkill(
    api,
    session.agentSession.id,
    resolved.skill,
  );
  const scope = loaded.project?.name
    ? `project ${loaded.project.name}`
    : "global";
  if (!prompt.trim()) {
    session.pendingSkill = loaded;
    console.log(
      `${C.warn}${C.bold}◆ /${loaded.name} queued${C.reset}${C.dim} · next message · ${scope}${C.reset}`,
    );
    return "handled";
  }
  session.history.push({ role: "user", text: prompt.trim() });
  if (session.history.length > 48)
    session.history.splice(0, session.history.length - 48);
  await runTurn(loaded);
  return "handled";
}

export async function handleSlash(rl, line, session, { runTurn, runSubagent }) {
  const [cmd, ...args] = line.trim().split(/\s+/);
  const local = await handleLocalCommand(cmd, args, session, { runCli, runSubagent });
  if (local) return local;
  switch (cmd) {
    case "/help":
      printHelp();
      return "handled";
    case "/new":
      await startNewSession(rl, session, args.join(" "));
      session.state = await state();
      return "refresh";
    case "/restart":
      return "restart";
    case "/session":
    case "/sessions":
    case "/resume":
      if (!args.length) await resumePicker(rl, session);
      else await resumeInto(rl, session, args.join(" "));
      return "refresh";
    case "/rename": {
      const name = args.join(" ").trim();
      if (!name) console.log("usage: /rename <short-name>");
      else {
        const renamed = await renameCurrentSessionName(session, name);
        console.log(`${C.c}✓ session name: @${renamed}${C.reset}`);
      }
      return "handled";
    }
    case "/title": {
      const title = args.join(" ").trim();
      if (!title) console.log("usage: /title <session name>");
      else {
        const renamed = await renameCurrentSession(session, title);
        console.log(`${C.c}✓ session title: ${renamed}${C.reset}`);
      }
      return "handled";
    }
    case "/status":
    case "/context":
      printDetailedStatus(session, C);
      return "handled";
    case "/permission": {
      const direct = args.length ? permissionMode(args.join(" ")) : null;
      if (args.length && !direct) {
        console.log("usage: /permission [ask|auto-write|yolo]");
        return "handled";
      }
      if (direct) session.permission = direct.id;
      else {
        const selected = await rl.question(
          `${C.blue}${C.bold}permission ›${C.reset} `,
          {
            history: false,
            complete: (value) => permissionCompletionItems(value),
            panelLabel: "permission mode",
            selectOnEnter: true,
            escapeCancels: true,
          },
        );
        if (selected)
          session.permission =
            permissionMode(selected)?.id || session.permission;
      }
      console.log(`permission ${session.permission}`);
      return "handled";
    }
    case "/statusbar": {
      const value = String(args[0] || "").toLowerCase();
      if (value === "off") session.statusBar = false;
      else if (value === "on") session.statusBar = true;
      else session.statusBar = !session.statusBar;
      console.log(`status bar ${session.statusBar ? "on" : "off"}`);
      return "handled";
    }
    case "/models":
      runCli(["models", ...args]);
      session.state = await state();
      return "refresh";
    case "/model":
      runCli(["model", ...args]);
      session.state = await state();
      return "refresh";
    case "/setup":
      runCli(["onboard"]);
      session.state = await state();
      return "refresh";
    case "/integrations":
      runCli(["integrations", ...args]);
      session.state = await state();
      return "refresh";
    // Compatibility aliases kept executable for older muscle memory/scripts, but
    // intentionally hidden from the slash palette. Product-facing setup is Integrations.
    case "/providers":
      runCli(["provider", "list"]);
      session.state = await state();
      return "refresh";
    case "/provider":
      if (!args[0])
        console.log("usage: /provider dokploy|cloudflare|hostinger");
      else runCli(["provider", "set", args[0]]);
      session.state = await state();
      return "refresh";
    case "/doctor":
      runCli(["doctor"]);
      return "handled";
    case "/tools":
      for (const tool of session.state.tools)
        console.log(`  ${String(tool.scope).padEnd(5)} ${tool.name}`);
      return "handled";
    case "/skills":
      printSkills(session, C, args.join(" "));
      return "handled";
    case "/skill":
      if (!args[0]) {
        console.log("usage: /skill <name-or-exact-id> [prompt]");
        return "handled";
      }
      return selectSlashSkill(
        rl,
        session,
        args[0],
        args.slice(1).join(" "),
        runTurn,
      );
    case "/clear":
      Object.assign(session, {
        history: [],
        pendingSkill: null,
        activeSkill: null,
        lastInvokedSkill: null,
      });
      rl.replaceHistory([]);
      await persistSession(session);
      console.log("conversation and prompt history cleared.");
      return "handled";
    case "/exit":
    case "/quit":
      return "exit";
    default:
      return selectSlashSkill(
        rl,
        session,
        cmd.slice(1),
        args.join(" "),
        runTurn,
      );
  }
}
