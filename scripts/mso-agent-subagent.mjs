import { persistSession } from "./mso-agent-session-ui.mjs";
import { printSection } from "./mso-agent-layout.mjs";

export const SUBAGENT_USAGE = "/spawn [--name <name>] [--scope read|write|exec] [--turns 1-12] <objective>";

export function parseSubagentArgs(args = []) {
  let name = "worker", maxScope = "read", maxTurns;
  const rest = [...args];
  for (let i = 0; i < rest.length;) {
    if (rest[i] === "--name") { name = String(rest[i + 1] || "worker"); rest.splice(i, 2); continue; }
    if (rest[i] === "--scope") { maxScope = String(rest[i + 1] || "read"); rest.splice(i, 2); continue; }
    if (rest[i] === "--turns") { maxTurns = Number(rest[i + 1]); rest.splice(i, 2); continue; }
    i += 1;
  }
  if (!["read", "write", "exec"].includes(maxScope)) throw new Error(`usage: ${SUBAGENT_USAGE}`);
  const objective = rest.join(" ").trim();
  if (!objective || (maxTurns && (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 12)))
    throw new Error(`usage: ${SUBAGENT_USAGE}`);
  return { objective, name, max_scope: maxScope, ...(maxTurns ? { max_turns: maxTurns } : {}) };
}

export async function runForegroundSubagent({ rl, session, input, executeTool, colors }) {
  const tool = session.state.tools.find((row) => row.name === "agent_subagent_run");
  if (!tool) throw new Error("agent_subagent_run is unavailable; refresh the MSO runtime/tool catalog");
  const call = { id: `slash_subagent_${Date.now()}`, name: "agent_subagent_run", input };
  printSection("work", { detail: `subagent ${input.name || "worker"}`, colors });
  const outcome = await executeTool(rl, tool, call, session.agentSession, session.permission, undefined, null, { approvalState: session });
  if (!outcome.ok) throw new Error(outcome.result || "subagent failed");
  let parsed = null;
  try { parsed = JSON.parse(outcome.result); } catch {}
  const text = String(parsed?.text || outcome.result || "").trim();
  const name = String(parsed?.name || input.name || "worker");
  session.history.push({
    role: "subagent", subagentId: parsed?.subagentId, name, objective: input.objective,
    status: parsed?.status || "completed", text, createdAt: new Date().toISOString(),
  });
  await persistSession(session);
  console.log(`${colors.c}${colors.bold}[subagent-${name}]${colors.reset} ${text || "completed"}`);
}
