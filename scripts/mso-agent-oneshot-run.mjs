import process from "node:process";
import { state } from "./mso-agent-api.mjs";
import { persistSession, resumeArg, startupSession } from "./mso-agent-session-ui.mjs";
import { agentRound } from "./mso-agent-turn.mjs";

// One-shot runs without a composer, without a viewport and without the alternate screen: it is
// one prompt in, text or JSON out, so it stays here rather than inside the interactive entrypoint.
export async function runOneShot(opts) {
  const requested = resumeArg(process.argv.slice(2));
  const [s, agentSession] = await Promise.all([state(), startupSession(requested)]);
  if (!agentSession || agentSession.source !== "cli") throw new Error("could not establish a CLI MSO Agent session");
  const session = {
    state: s, agentSession, history: Array.isArray(agentSession.history) ? agentSession.history : [],
    pendingSkill: null, activeSkill: null, lastInvokedSkill: null,
    titleOverride: requested ? (agentSession.title || null) : null,
    usage: { apiCalls: 0 }, lastRouting: null, lastElapsedMs: 0, statusBar: false,
    permission: "ask", pendingApproval: null,
  };
  session.history.push({ role: "user", text: opts.prompt });
  // `--thinking` is a REPORTING flag only: the stream exposes reasoning token counts,
  // not reasoning text, so nothing here changes the turn. Passing `thinking` into
  // agentRound would be dead config, so the flag is consumed in the payload below.
  const result = await agentRound(null, session, null, undefined, null, { quiet: true, approvalScope: opts.approvalScope });
  await persistSession(session);
  const payload = {
    ok: true, sessionId: session.agentSession.id,
    model: `${s.config?.provider || ""}/${s.config?.model || ""}`.replace(/^\//, ""),
    approvalScope: opts.approvalScope, text: result?.text || "", rounds: result?.rounds || 0,
    toolCalls: result?.calls || [], usage: result?.usage || session.usage, routing: session.lastRouting, elapsedMs: result?.elapsedMs || session.lastElapsedMs,
    // Prove what was actually attached instead of leaving --file unverifiable.
    ...(opts.files?.length ? { files: opts.files } : {}),
    // `--thinking` surfaces the reasoning ACCOUNTING the provider really reported.
    // Streams capture reasoning tokens, not reasoning text, so claiming a reasoning
    // block here would be invented output.
    ...(opts.thinking ? { thinking: true, reasoningTokens: (result?.usage ?? session.usage)?.reasoningTokens ?? null } : {}),
    ...(result?.turnLimitReached ? { turnLimitReached: true } : {}),
  };
  if (opts.json) process.stdout.write(`${JSON.stringify(payload)}\n`);
  else process.stdout.write(`${payload.text}${payload.text.endsWith("\n") || !payload.text ? "" : "\n"}`);
}
