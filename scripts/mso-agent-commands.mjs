import { spawnSync } from "node:child_process";
import process from "node:process";
import { C, BASE, CLI, api, state } from "./mso-agent-runtime.mjs";
import {
  loadSlashSkill,
  printSkillChoices,
  printSkills,
  resolveSlashSkill,
} from "./mso-agent-skills.mjs";
import {
  persistSession,
  renameCurrentSession,
  resumeInto,
  startNewSession,
  resumePicker,
} from "./mso-agent-session-ui.mjs";
import { printDetailedStatus } from "./mso-agent-status.mjs";
import {
  permissionCompletionItems,
  permissionMode,
} from "./mso-agent-permissions.mjs";

function runCli(args) {
  const result = spawnSync(CLI, args, {
    stdio: "inherit",
    env: { ...process.env, MSO_BASE: BASE },
  });
  if (result.error) console.error(`${C.err}${result.error.message}${C.reset}`);
  return result.status ?? 1;
}

function localAgentLine(row) {
  const status = String(row?.status || "unknown");
  const cwd = row?.cwd ? ` · ${row.cwd}` : "";
  return `  ${String(row?.label || row?.alias || row?.id || "agent").padEnd(24)} ${status}${cwd}`;
}

async function listLocalAgents(session, includeOffline = false) {
  const query = new URLSearchParams({ session: session.agentSession.id });
  if (includeOffline) query.set("includeOffline", "1");
  const out = await api(`/api/v1/local-agents?${query}`);
  const rows = Array.isArray(out?.agents) ? out.agents : [];
  if (!rows.length) console.log("  no other live local session agents");
  else for (const row of rows) console.log(localAgentLine(row));
  return rows;
}

async function sendLocalAgent(session, target, message, kind = "message") {
  return api("/api/v1/local-agents", {
    method: "POST",
    body: JSON.stringify({ action: "send", sessionId: session.agentSession.id, target, message, kind }),
  });
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

function printHelp() {
  console.log(
    [
      "  /new [name]             create and switch to a fresh durable session",
      "  /restart                soft-reload Agent runtime; keep this session",
      "  /session [query]        open picker or resume latest/index/id/title",
      "  /resume [query]         alias-style resume command; bare opens same picker",
      "  /title <name>           rename the durable session",
      "  /status                 model/auth/context/token/session details",
      "  /permission [mode]      choose ask | auto-write | yolo",
      "  /context                alias for /status",
      "  /statusbar [on|off]     toggle compact dynamic status line",
      "  /models [args]          configure AI providers/auth",
      "  /model [ref]            select active model from connected providers",
      "  /setup                  full MSO onboarding",
      "  /providers              infrastructure provider status",
      "  /provider <id>          configure dokploy|cloudflare|hostinger",
      "  /doctor                 run mso doctor",
      "  /tools                  list agent tools",
      "  /agents                 list live local session agents + remote A2A peers",
      "  /message <target> <msg> send a native local agent message",
      "  /delegate <target> <job> queue native local task; else remote A2A peer",
      "  /spawn [--name N] <job> spawn same-host sub-agent from this session",
      "  /inbox                  show native local agent messages for this session",
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
      "  Ctrl+W · Ctrl+U/K       delete word · delete to line start/end",
      "  ↑/↓ or Ctrl+P/N         prompt history (durable after resume)",
      "  Ctrl+A/E · Ctrl+B/F     line start/end · left/right",
      "  Alt+B/F · Ctrl+←/→      move by word",
      "  Tab (empty prompt)       cycle permission in place: ask → auto → yolo",
    ].join("\n"),
  );
}

export async function handleSlash(rl, line, session, { runTurn }) {
  const [cmd, ...args] = line.trim().split(/\s+/);
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
    case "/agents":
      console.log(`${C.bold}Local session agents${C.reset}`);
      await listLocalAgents(session);
      console.log(`${C.bold}Remote A2A v1 peers${C.reset}`);
      runCli(["a2a", "list"]);
      return "handled";
    case "/message": {
      if (!args[0] || args.length < 2) {
        console.log("usage: /message <local-agent> <message>");
        return "handled";
      }
      const target = args[0];
      const message = args.slice(1).join(" ");
      const out = await sendLocalAgent(session, target, message, "message");
      console.log(`${C.c}↳ ${out?.target?.label || target}${C.reset} ${out?.status || "accepted"}`);
      return "handled";
    }
    case "/delegate": {
      if (!args[0] || args.length < 2) {
        console.log(
          "usage: /delegate <session-name|session-id|cwd|peer> <objective>",
        );
        return "handled";
      }
      const target = args[0];
      const objective = args.slice(1).join(" ");
      try {
        const out = await sendLocalAgent(session, target, objective, "task");
        console.log(`${C.c}↳ ${out?.target?.label || target}${C.reset} ${out?.status || "accepted"}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/local agent target not found/i.test(message))
          runCli(["a2a", "handoff", target, objective]);
        else throw error;
      }
      return "handled";
    }
    case "/spawn": {
      let title = "";
      const rest = [...args];
      if (rest[0] === "--name") {
        title = String(rest[1] || "");
        rest.splice(0, 2);
      }
      const objective = rest.join(" ").trim();
      if (!objective) {
        console.log("usage: /spawn [--name <name>] <objective>");
        return "handled";
      }
      const out = await api("/api/v1/a2a", {
        method: "POST",
        body: JSON.stringify({
          action: "local-spawn",
          sourceSessionRef: session.agentSession.id,
          objective,
          ...(title ? { title } : {}),
        }),
      });
      const text = out?.task?.artifacts?.[0]?.parts?.[0]?.text || "completed";
      console.log(
        `${C.c}↳ spawned ${out?.session?.title || "subagent"}${C.reset} ${text}`,
      );
      return "handled";
    }
    case "/inbox": {
      const out = await api(`/api/v1/local-agents?inbox=1&session=${encodeURIComponent(session.agentSession.id)}&limit=100`);
      const rows = Array.isArray(out?.messages) ? out.messages : [];
      if (!rows.length) console.log("local agent inbox is empty");
      else for (const row of rows) {
        const label = String(row.senderLabel || "[agent]");
        const prefix = label.startsWith("[agent-") ? label : `[agent-${label.replace(/^\[|\]$/g, "")}]`;
        console.log(`${C.c}${prefix}${row.kind === "task" ? " task" : ""}${C.reset} ${row.text}`);
      }
      return "handled";
    }
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
