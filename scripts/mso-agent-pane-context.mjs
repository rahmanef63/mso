import { contextStatus, statusParts } from "./mso-agent-status.mjs";

function compactTokens(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(n));
}

// Renders context usage bar when window limit is known; returns null when unknown
// so the caller can display a question mark instead of an invented percentage.
export function renderProportionBar(percent, width = 12) {
  if (percent == null || !Number.isFinite(percent)) return null;
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  const barWidth = Math.max(4, Number(width) || 12);
  const filled = Math.max(0, Math.min(barWidth, Math.round((p / 100) * barWidth)));
  const unfilled = barWidth - filled;
  return `[${"█".repeat(filled)}${"░".repeat(unfilled)}] ${p}%`;
}

function resolveMcpServers(mcpServers, session) {
  if (Array.isArray(mcpServers)) return mcpServers;
  if (Array.isArray(session?.mcpServers)) return session.mcpServers;
  if (Array.isArray(session?.state?.mcpServers)) return session.state.mcpServers;
  if (Array.isArray(session?.mcp)) return session.mcp;
  if (Array.isArray(session?.state?.mcp)) return session.state.mcp;
  return [];
}

// MCP pane renders one row per server with name and tool count, dimmed when down.
export function formatMcpContent({ session, mcpServers }) {
  const servers = resolveMcpServers(mcpServers, session);
  if (!servers.length) {
    return { title: "MCP", emptyText: "no MCP servers", rows: [] };
  }
  const rows = servers.map((server) => {
    const name = String(server?.name || server?.id || "server");
    const count = typeof server?.toolCount === "number"
      ? server.toolCount
      : (Array.isArray(server?.tools)
        ? server.tools.length
        : (typeof server?.tools === "number" ? server.tools : 0));
    const isDown = Boolean(
      server?.error ||
      server?.isError ||
      server?.connected === false ||
      server?.status === "disconnected" ||
      server?.status === "error" ||
      server?.status === "errored" ||
      server?.state === "disconnected" ||
      server?.state === "error"
    );
    const countLabel = count === 1 ? "1 tool" : `${count} tools`;
    // Dimming alone is not enough: with a bare palette the line looked identical to a connected
    // server, so a user reading the pane could not tell a broken MCP server from a healthy one.
    return {
      text: isDown ? `${name} (offline)` : `${name} (${countLabel})`,
      tone: isDown ? "dim" : "normal",
    };
  });
  return { title: "MCP", emptyText: null, rows };
}

// Context pane shows active provider/model, token usage, turns, and proportion bar.
export function formatContextContent({ session }) {
  // Call statusParts to reuse the established status calculations.
  statusParts(session);
  const cfg = session?.state?.config || {};
  const provider = String(cfg.provider || "none");
  const model = String(cfg.model || "none");
  const history = Array.isArray(session?.history)
    ? session.history
    : (Array.isArray(session?.agentSession?.history) ? session.agentSession.history : []);
  const ctx = contextStatus(history, session?.state?.modelMeta);
  // history is the durable transcript, but a session that has run turns carries the provider's own
  // accounting in usage. Prefer the larger of the two: showing ~0 tokens next to a live model that
  // just billed 47k is the kind of number that teaches the user to distrust the pane.
  const reported = Number(session?.usage?.totalTokens ?? session?.usage?.promptTokens ?? 0) || 0;
  if (reported > ctx.used) ctx.used = reported;
  const turns = history.filter((row) => row?.role === "user").length || Number(session?.usage?.apiCalls || 0);

  const rows = [];
  rows.push({ text: `${provider}/${model}`, tone: "header" });

  if (ctx.limit) {
    rows.push({
      text: `tokens: ~${compactTokens(ctx.used)} / ${compactTokens(ctx.limit)}`,
      tone: "normal",
    });
    const bar = renderProportionBar(ctx.percent, 12);
    rows.push({ text: `bar: ${bar}`, tone: "normal" });
  } else {
    // Window limit is unknown; render ? without inventing a percentage.
    rows.push({ text: `tokens: ~${compactTokens(ctx.used)} / ?`, tone: "normal" });
    rows.push({ text: "bar: ?", tone: "dim" });
  }

  rows.push({ text: `turns: ${turns}`, tone: "normal" });

  // If system tokens are explicitly recorded, show breakdown without guessing.
  if (typeof session?.systemTokens === "number") {
    rows.push({
      text: `system: ~${compactTokens(session.systemTokens)} · history: ~${compactTokens(ctx.used)}`,
      tone: "dim",
    });
  } else {
    rows.push({ text: `history: ~${compactTokens(ctx.used)} stored`, tone: "dim" });
  }

  return { title: "Context", emptyText: null, rows };
}
