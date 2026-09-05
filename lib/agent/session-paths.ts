import os from "node:os";
import path from "node:path";
export const SESSION_ID = /^\d{8}_\d{6}_[a-f0-9]{8}$/;
/** The same configured root owns session records and disposable session artifacts. */
export function agentSessionsDir(): string {
  return path.resolve(
    (process.env.OS_AGENT_SESSIONS_DIR || path.join(os.homedir(), ".mso", "agent-sessions")).replace(/^~(?=$|\/)/, os.homedir()),
  );
}
