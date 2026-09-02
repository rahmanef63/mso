import { api } from "./mso-agent-api.mjs";
import { persistSession } from "./mso-agent-session-ui.mjs";
import { sectionBlock } from "./mso-agent-layout.mjs";
import { safeErrorSummary } from "./mso-agent-errors.mjs";

function clean(value) {
  return String(value || "").trim().replace(/^\[|\]$/g, "").toLocaleLowerCase();
}

function parsedTarget(line) { return parseLocalAgentMention(line)?.target || "peer"; }

export function parseLocalAgentMention(line) {
  const match = String(line || "").match(/^@([^\s]+)\s+([\s\S]+)$/);
  if (!match) return null;
  const target = clean(match[1]);
  const prompt = String(match[2] || "").trim();
  return target && prompt ? { target, prompt } : null;
}

export function resolveLocalAgentMention(rows, token) {
  const wanted = clean(token);
  const activeRows = (Array.isArray(rows) ? rows : []).filter((row) =>
    !["offline", "ended"].includes(String(row?.status || "")) && row?.consumerConnected === true,
  );
  const matches = activeRows.filter((row) => [row?.name, row?.label].map(clean).filter(Boolean).includes(wanted));
  if (!matches.length) {
    const available = activeRows.map((row) => `@${row.name}`).slice(0, 12).join(", ");
    throw new Error(`local agent mention @${wanted} not found${available ? `; available: ${available}` : ""}`);
  }
  if (matches.length > 1) {
    const names = matches.map((row) => `@${row.name}`).join(" or ");
    throw new Error(`local agent mention @${wanted} is ambiguous; use ${names}`);
  }
  return matches[0];
}

export function mentionAck(result) {
  const label = result?.target?.label || "[local-agent]";
  const status = String(result?.status || "accepted");
  if (status === "target_offline") return `${label} queued · target offline · correlated reply will relay here after it returns`;
  if (status === "queued") return `${label} queued · target busy · correlated reply will relay here`;
  if (status === "delivered") return `${label} delivered · correlated reply will relay here`;
  if (status === "accepted" && result?.target?.consumerConnected === false) return `${label} queued · active lease, but no receiver is subscribed · durable inbox will wait`;
  if (status === "accepted") return `${label} accepted · waiting for an explicit target turn; correlated reply will relay here`;
  return `${label} ${status}`;
}

export async function dispatchLocalAgentMention(session, line, deps = {}) {
  const parsed = parseLocalAgentMention(line);
  if (!parsed) return null;
  const request = deps.api || api;
  const save = deps.persist || persistSession;
  let directory;
  try {
    directory = await request(`/api/v1/local-agents?session=${encodeURIComponent(session.agentSession.id)}`, {
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    if (error?.name === "TimeoutError") throw new Error("local agent mention lookup timed out; no message was sent");
    throw error;
  }
  const target = resolveLocalAgentMention(directory?.agents, parsed.target);
  let result;
  try {
    result = await request("/api/v1/local-agents", {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        action: "send",
        sessionId: session.agentSession.id,
        target: target.id,
        message: parsed.prompt,
        kind: "message",
        intent: "request",
        requiresUserRelay: true,
        activeOnly: true,
      }),
    });
  } catch (error) {
    if (error?.name === "TimeoutError")
      throw new Error("local agent dispatch timed out; delivery is unconfirmed and MSO will not resend automatically");
    throw error;
  }
  const requestRow = {
    role: "local_request",
    messageId: result.message.id,
    correlationId: result.message.correlationId,
    targetSessionId: result.target.id,
    targetLabel: result.target.label,
    text: parsed.prompt,
    status: result.status,
    createdAt: result.message.createdAt,
    requiresUserRelay: true,
  };
  session.history.push({ role: "user", text: line, localMention: true, correlationId: result.message.correlationId });
  session.history.push({ role: "assistant", text: `Delegated to ${result.target.label}. I will relay its correlated reply when it arrives.` });
  session.history.push(requestRow);
  await save(session);
  return { result, request: requestRow, acknowledgement: mentionAck(result) };
}

export async function handleLocalAgentMentionInput(session, line, colors) {
  if (!String(line || "").startsWith("@")) return false;
  try {
    const mention = await dispatchLocalAgentMention(session, line);
    if (!mention) return false;
    console.log(sectionBlock("local", `${colors.c}↳ ${mention.acknowledgement}${colors.reset}`, {
      columns: process.stdout.columns, detail: mention.result?.target?.label || parsedTarget(line), colors,
    }));
    return true;
  } catch (error) {
    console.error(sectionBlock("error", `${colors.err}${safeErrorSummary(error)}${colors.reset}`, {
      columns: process.stdout.columns, detail: "local agent", colors,
    }));
    return true;
  }
}
