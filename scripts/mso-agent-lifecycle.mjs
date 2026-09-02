import process from "node:process";
import { CLI } from "./mso-agent-runtime.mjs";

const RESTART_PERMISSION_ENV = "MSO_AGENT_RESTART_PERMISSION";
const RESTART_STATUSBAR_ENV = "MSO_AGENT_RESTART_STATUSBAR";

export function consumeRestartUiState() {
  const permission = String(process.env[RESTART_PERMISSION_ENV] || "").trim();
  const statusBarRaw = String(process.env[RESTART_STATUSBAR_ENV] || "").trim().toLowerCase();
  delete process.env[RESTART_PERMISSION_ENV];
  delete process.env[RESTART_STATUSBAR_ENV];
  return {
    permission: ["ask", "auto", "yolo"].includes(permission) ? permission : null,
    statusBar: statusBarRaw === "off" ? false : statusBarRaw === "on" ? true : null,
  };
}

export function relaunchAgentSession(
  { cli, sessionId, permission = "ask", statusBar = true },
  execve = process.execve,
) {
  const id = String(sessionId || "").trim();
  if (!id) throw new Error("cannot restart MSO Agent without a durable session id");
  if (typeof execve !== "function") throw new Error("this Node runtime cannot replace the Agent process safely");
  const command = String(cli || "mso");
  const env = {
    ...process.env,
    [RESTART_PERMISSION_ENV]: ["ask", "auto", "yolo"].includes(permission)
      ? permission
      : "ask",
    [RESTART_STATUSBAR_ENV]: statusBar === false ? "off" : "on",
  };
  // execve replaces the current process image instead of spawning a child. Combined
  // with the CLI wrapper's `exec node`, repeated /restart keeps a constant process
  // depth and reloads both the current wrapper and Agent modules from disk.
  execve(command, [command, "agent", "--restart-session", id], env);
  throw new Error("MSO Agent process replacement unexpectedly returned");
}

export function relaunchCurrentAgentSession(session) {
  return relaunchAgentSession({
    cli: CLI,
    sessionId: session?.agentSession?.id,
    permission: session?.permission,
    statusBar: session?.statusBar,
  });
}
