import { spawnSync } from "node:child_process";
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
  runner = spawnSync,
) {
  const id = String(sessionId || "").trim();
  if (!id) throw new Error("cannot restart MSO Agent without a durable session id");
  const env = {
    ...process.env,
    [RESTART_PERMISSION_ENV]: ["ask", "auto", "yolo"].includes(permission)
      ? permission
      : "ask",
    [RESTART_STATUSBAR_ENV]: statusBar === false ? "off" : "on",
  };
  const result = runner(String(cli || "mso"), ["agent", "--resume", id], {
    stdio: "inherit",
    env,
  });
  if (result?.error) throw result.error;
  return Number.isInteger(result?.status) ? result.status : 1;
}

export function relaunchCurrentAgentSession(session) {
  return relaunchAgentSession({
    cli: CLI,
    sessionId: session?.agentSession?.id,
    permission: session?.permission,
    statusBar: session?.statusBar,
  });
}
