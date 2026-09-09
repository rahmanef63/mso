import process from "node:process";
import { C } from "./mso-agent-runtime.mjs";
import { api } from "./mso-agent-api.mjs";
import { persistSession } from "./mso-agent-session-ui.mjs";
import { sectionBlock, printSection } from "./mso-agent-layout.mjs";
import { parseSubagentArgs, SUBAGENT_USAGE } from "./mso-agent-subagent.mjs";

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

async function sendLocalAgent(session, target, message, kind = "message", options = {}) {
  return api("/api/v1/local-agents", {
    method: "POST",
    body: JSON.stringify({ action: "send", sessionId: session.agentSession.id, target, message, kind, ...options }),
  });
}

async function trackLocalRequest(session, out, text) {
  if (!out?.message?.id || !out?.message?.correlationId) return;
  session.history.push({
    role: "local_request", messageId: out.message.id, correlationId: out.message.correlationId,
    targetSessionId: out.target.id, targetLabel: out.target.label, text, status: out.status,
    createdAt: out.message.createdAt, requiresUserRelay: true,
  });
  await persistSession(session);
}

export async function handleLocalCommand(cmd, args, session, { runCli, runSubagent }) {
  switch (cmd) {
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
      console.log(sectionBlock("local", `${C.c}↳ ${out?.target?.label || target}${C.reset} ${out?.status || "accepted"}`, {
        columns: process.stdout.columns, detail: out?.target?.label || target, colors: C,
      }));
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
        const out = await sendLocalAgent(session, target, objective, "task", { intent: "request", requiresUserRelay: true });
        await trackLocalRequest(session, out, objective);
        console.log(sectionBlock("local", `${C.c}↳ ${out?.target?.label || target}${C.reset} ${out?.status || "accepted"} · correlated reply will relay here`, {
          columns: process.stdout.columns, detail: out?.target?.label || target, colors: C,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/local agent target not found/i.test(message))
          runCli(["a2a", "handoff", target, objective]);
        else throw error;
      }
      return "handled";
    }
    case "/spawn": {
      if (typeof runSubagent !== "function") throw new Error("subagent runtime unavailable");
      try { await runSubagent(parseSubagentArgs(args)); }
      catch (error) {
        if (String(error?.message || error).startsWith("usage:")) console.log(`usage: ${SUBAGENT_USAGE}`);
        else throw error;
      }
      return "handled";
    }
    case "/inbox": {
      const out = await api(`/api/v1/local-agents?inbox=1&session=${encodeURIComponent(session.agentSession.id)}&limit=100`);
      const rows = Array.isArray(out?.messages) ? out.messages : [];
      if (!rows.length) console.log("local agent inbox is empty");
      else {
        printSection("local", { detail: "inbox", colors: C });
        for (const row of rows) {
          const label = String(row.senderLabel || "[agent]");
          const prefix = label.startsWith("[agent-") ? label : `[agent-${label.replace(/^\[|\]$/g, "")}]`;
          console.log(`${C.c}${prefix}${row.kind === "task" ? " task" : ""}${C.reset} ${row.text}`);
        }
      }
      return "handled";
    }
    default: return null;
  }
}
