import { spawnSync } from "node:child_process";
import process from "node:process";
import { C } from "./mso-agent-runtime.mjs";
import { BASE, CLI, api, state } from "./mso-agent-api.mjs";
import {
  loadSlashSkill,
  printSkillChoices,
  resolveSlashSkill,
} from "./mso-agent-skills.mjs";
import { handleLocalCommand } from "./mso-agent-local-commands.mjs";
import { printHelp } from "./mso-agent-help.mjs";
import {
  SHARE_UNAVAILABLE_MESSAGE,
  buildExportArgv,
  handleParityCommand,
} from "./mso-agent-cmd-parity.mjs";
import { handleInspectCommand } from "./mso-agent-cmd-inspect.mjs";
import { handleSessionCommand } from "./mso-agent-cmd-session.mjs";

export { SHARE_UNAVAILABLE_MESSAGE, buildExportArgv };

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

  const ctx = {
    rl,
    session,
    runTurn,
    runSubagent,
    runCli,
    api,
    state,
    C,
  };

  const sessionOutcome = await handleSessionCommand(ctx, cmd, args);
  if (sessionOutcome !== null) return sessionOutcome;

  const inspectOutcome = await handleInspectCommand(ctx, cmd, args);
  if (inspectOutcome !== null) return inspectOutcome;

  const parityOutcome = await handleParityCommand(ctx, cmd, args);
  if (parityOutcome !== null) return parityOutcome;

  switch (cmd) {
    case "/help":
      printHelp();
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
