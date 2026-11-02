// Single source of truth for command metadata and help derivation.
export const COMMAND_MANIFEST = [
  { name: "/help", description: "show slash commands and keyboard shortcuts" },
  { name: "/new", usage: "[title]", description: "create and switch to a fresh durable session" },
  { name: "/restart", description: "soft-reload Agent runtime; keep this session" },
  { name: "/session", usage: "[query]", description: "open picker or resume latest/index/id/@name/title (alias: /sessions)" },
  { name: "/resume", usage: "[query]", description: "alias-style resume command; bare opens same picker" },
  { name: "/tabs", usage: "[n|name|next|prev]", description: "list tabs, switch by index/@name, or jump active" },
  { name: "/rename", usage: "<name>", description: "rename the short @agent handle" },
  { name: "/title", usage: "<text>", description: "rename the session title/description" },
  { name: "/export", usage: "[ref] [--out f]", description: "export session transcript to stdout or a file" },
  { name: "/share", description: "temporary share link (server download-only today)" },
  { name: "/status", description: "model/auth/context/token/session details" },
  { name: "/permission", usage: "[mode]", description: "choose ask | auto-write | yolo" },
  { name: "/context", description: "alias for /status" },
  { name: "/diff", usage: "[ref] [--full]", description: "show diff viewer panel for artifact write action" },
  { name: "/todos", usage: "[--all]", description: "show session checklist from todo_write" },
  { name: "/pane", usage: "[kind|pin|unpin]", description: "cycle, set, or pin side pane (todos, diff, files, off)" },
  { name: "/keybind", usage: "[sub]", description: "view keybindings (sub: reset, conflicts)" },
  { name: "/settings", usage: "[key] [val]", description: "view or set TUI preferences (sub: reset)" },
  { name: "/compact", description: "force context compaction and archive history" },
  { name: "/statusbar", usage: "[on|off]", description: "toggle compact dynamic status line" },
  { name: "/reasoning", usage: "[on|off]", description: "toggle per-turn reasoning token metrics (/reasoning on|off)" },
  { name: "/theme", usage: "[name|status]", description: "view or set UI theme (dark, light, mono)" },
  { name: "/models", usage: "[args]", description: "configure AI providers/auth" },
  { name: "/model", usage: "[ref]", description: "select active model from connected providers" },
  { name: "/setup", description: "full MSO onboarding" },
  { name: "/integrations", usage: "[args]", description: "manage users, providers, connections, source/auth" },
  { name: "/provider, /providers", description: "legacy provider setup (alias; see /integrations)" },
  { name: "/doctor", description: "run mso doctor" },
  { name: "/tools", description: "list agent tools" },
  { name: "/files", usage: "[path]", description: "read-only file tree of cwd or path (bounded)" },
  { name: "/agents", description: "list live local session agents + remote A2A peers" },
  { name: "@milo", usage: "<prompt>", description: "message an active local agent by its short @name" },
  { name: "/message", usage: "<target> <msg>", description: "send notify-only local agent data" },
  { name: "/delegate", usage: "<target> <job>", description: "correlated local task; else remote A2A peer" },
  { name: "/spawn", usage: "[--name N] [--scope S] <job>", description: "run foreground isolated subagent in this session" },
  { name: "/jobs", usage: "[id|cancel <id>]", description: "list background subagent jobs, inspect, or cancel" },
  { name: "/terminal", usage: "[cmd]", description: "open shell or run command in real terminal" },
  { name: "/inbox", description: "show native local agent messages for this session" },
  { name: "/skills", usage: "[query]", description: "browse available slash skills" },
  { name: "/skill", usage: "<id> [prompt]", description: "select exact skill id (ambiguity escape hatch)" },
  { name: "/<skill>", usage: "[prompt]", description: "select for next message, or run prompt now" },
  { name: "/queue", usage: "[drop|clear|prompt]", description: "list, drop, clear, or queue follow-up prompts" },
  { name: "/stash", usage: "[pop|clear|text]", description: "park prompt; /stash pop prints stashed prompt to terminal" },
  { name: "/image", usage: "<path>", description: "attach a local image to the next prompt" },
  { name: "/clear", description: "clear this session conversation" },
  { name: "/exit, /quit", description: "quit" },
  { name: "--no-altscreen", description: "keep the terminal's own scrollback instead of the retained panel" },
];

import { spawnSync } from "node:child_process";
import process from "node:process";
import { C } from "./mso-agent-runtime.mjs";
import { BASE, CLI, api, state } from "./mso-agent-api.mjs";
import { leaveScreen } from "./mso-agent-altscreen.mjs";
import {
  loadSlashSkill,
  printSkillChoices,
  resolveSlashSkill,
} from "./mso-agent-skills.mjs";
import { handleLocalCommand } from "./mso-agent-local-commands.mjs";
import {
  SHARE_UNAVAILABLE_MESSAGE,
  buildExportArgv,
  handleParityCommand,
} from "./mso-agent-cmd-parity.mjs";
import { handleInspectCommand } from "./mso-agent-cmd-inspect.mjs";
import { handleSessionCommand } from "./mso-agent-cmd-session.mjs";
import { handleJobsCommand } from "./mso-agent-jobs.mjs";
import { handleTerminalCommand } from "./mso-agent-cmd-terminal.mjs";
import { handleSettingsCommand } from "./mso-agent-cmd-settings.mjs";
import { handleQueueCommand } from "./mso-agent-cmd-queue.mjs";
import { createPrinter } from "./mso-agent-print.mjs";

export { SHARE_UNAVAILABLE_MESSAGE, buildExportArgv };

function runCli(args) {
  // Releases the alternate screen buffer before handing the terminal to an interactive child process.
  leaveScreen();
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
  const { print } = createPrinter({ session, colors: C });
  if (!prompt.trim()) {
    session.pendingSkill = loaded;
    print(
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

// Dispatch table arms:
// case "/help": case "/new": case "/restart": case "/session": case "/sessions":
// case "/resume": case "/rename": case "/title": case "/export": case "/share":
// case "/status": case "/context": case "/diff": case "/compact": case "/permission":
// case "/statusbar": case "/reasoning": case "/theme": case "/models": case "/model":
// case "/setup": case "/integrations": case "/providers": case "/provider": case "/doctor":
// case "/tools": case "/files": case "/skills": case "/skill": case "/queue":
// case "/stash": case "/image": case "/clear": case "/exit": case "/quit":

export async function handleSlash(rl, line, session, { runTurn, runSubagent }) {
  const [cmd, ...args] = line.trim().split(/\s+/);
  const local = await handleLocalCommand(cmd, args, session, { runCli, runSubagent });
  if (local) return local;

  const printer = createPrinter({ session, colors: C });
  const ctx = {
    rl,
    session,
    runTurn,
    runSubagent,
    runCli,
    api,
    state,
    C,
    printer,
  };

  const sessionOutcome = await handleSessionCommand(ctx, cmd, args);
  if (sessionOutcome !== null) return sessionOutcome;

  const inspectOutcome = await handleInspectCommand(ctx, cmd, args);
  if (inspectOutcome !== null) return inspectOutcome;

  if (cmd === "/queue") return handleQueueCommand(ctx, args);

  const parityOutcome = await handleParityCommand(ctx, cmd, args);
  if (parityOutcome !== null) return parityOutcome;

  if (cmd === "/jobs") return handleJobsCommand(ctx, args);
  if (cmd === "/terminal" || cmd === "/term") return handleTerminalCommand(ctx, args);
  if (cmd === "/settings" || cmd === "/setting") return handleSettingsCommand(ctx, args);

  switch (cmd) {
    case "/help": {
      const { printHelp } = await import("./mso-agent-help.mjs");
      printHelp({ session });
      return "handled";
    }
    case "/skill":
      if (!args[0]) {
        printer.print("usage: /skill <name-or-exact-id> [prompt]");
        return "handled";
      }
      return selectSlashSkill(
        rl,
        session,
        args[0],
        args.slice(1).join(" "),
        runTurn,
      );
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
