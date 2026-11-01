import {
  persistSession, renameCurrentSession, renameCurrentSessionName,
  resumeInto, startNewSession, resumePicker,
} from "./mso-agent-session-ui.mjs";
import { api, listCliSessions, state } from "./mso-agent-api.mjs";
import { C } from "./mso-agent-runtime.mjs";
import { clearTodos, formatTodoBlock, latestTodos } from "./mso-agent-todos.mjs";
import { handleKeybindCommand } from "./mso-agent-keybinds.mjs";
import { visibleSessionRows } from "./mso-agent-sessions.mjs";
import { tabsToSwitch } from "./mso-agent-chrome.mjs";
import { attentionReason, findAttentionSession, sessionTable } from "./mso-agent-session-list.mjs";
import { cyclePane, paneKinds } from "./mso-agent-pane.mjs";
import { createPrinter } from "./mso-agent-print.mjs";
import { clean } from "./tui/cells.mjs";

export async function handleTodos(ctx, args = []) {
  const { C: colors = C } = ctx;
  const { print, printBlock } = createPrinter(ctx);
  const state = latestTodos();
  if (!state || (!state.items?.length && !state.summary)) {
    print("no todo list in this session yet: the agent writes one with todo_write");
    return "handled";
  }
  const showAll = args.includes("--all");
  const maxItems = showAll ? Number.POSITIVE_INFINITY : 12;
  const block = formatTodoBlock(state, { colors, maxItems });
  if (block) printBlock(block);
  else print("no todo list in this session yet: the agent writes one with todo_write");
  return "handled";
}

// Reuses the existing resume path and clears cached todos so the status
// chip never reflects a different session after switching.
export async function switchToSession(rl, session, sessionId) {
  if (!sessionId) return false;
  await resumeInto(rl, session, sessionId);
  clearTodos();
  return true;
}

export async function handleTabs(ctx, args = []) {
  const { rl, session, C: colors = C } = ctx;
  const { print } = createPrinter(ctx);
  const rows = visibleSessionRows(ctx.sessions || await listCliSessions(20));
  if (!args.length) {
    const width = Number(ctx.width || process.stdout.columns) || 80;
    const lines = sessionTable(rows, { colors, width, activeId: session?.agentSession?.id });
    for (const line of lines) print(line);
    return "handled";
  }
  const sub = String(args[0] || "").toLowerCase();
  if (sub === "next" || sub === "prev" || sub === "previous") {
    const activeId = session?.agentSession?.id;
    const now = Number(ctx.now) || Date.now();
    const target = findAttentionSession(rows, activeId, sub, now);
    if (!target) {
      print("no sessions need attention");
      return "handled";
    }
    const rawName = clean(target?.name || target?.agentSession?.name || "agent").replace(/^@/, "");
    const reason = attentionReason(target, now);
    print(`${colors.c || ""}jumped to @${rawName} (${reason})${colors.reset || ""}`);
    await switchToSession(rl, session, target.id);
    return "refresh";
  }
  const target = tabsToSwitch(rows, args);
  if (!target) {
    print(`could not resolve session: ${args.join(" ")}`);
    return "handled";
  }
  await switchToSession(rl, session, target.id);
  return "refresh";
}

export async function handlePane(ctx, args = []) {
  const { session, C: colors = C } = ctx;
  const { print } = createPrinter(ctx);
  const kinds = paneKinds();
  if (!args.length) {
    const current = session?.paneKind || "off";
    // When pinned, do not advance the slot; report the pinned slot to the user.
    if (session?.panePinned) {
      print(`${colors.c || ""}side pane: ${current} (pinned)${colors.reset || ""}`);
      return "handled";
    }
    const next = cyclePane(current);
    if (session) session.paneKind = next;
    print(`${colors.c || ""}side pane: ${next}${colors.reset || ""}`);
    return "handled";
  }
  const requested = String(args[0]).toLowerCase();
  if (requested === "pin") {
    // Pin locks the active slot (or requested slot argument) so cycling does not move away.
    // When pane is off, default to the first slot so pinning always presents a visible pane.
    const slot = args[1] ? String(args[1]).toLowerCase() : null;
    let target = slot && kinds.includes(slot) && slot !== "off" ? slot : session?.paneKind;
    if (!target || target === "off") target = kinds[0] || "todos";
    if (session) {
      session.paneKind = target;
      session.panePinned = true;
    }
    print(`${colors.c || ""}side pane: ${target} (pinned)${colors.reset || ""}`);
    return "handled";
  }
  if (requested === "unpin") {
    // Unpin restores regular cycling without altering the currently visible slot.
    if (session) session.panePinned = false;
    const current = session?.paneKind || "off";
    print(`${colors.c || ""}side pane: ${current} (unpinned)${colors.reset || ""}`);
    return "handled";
  }
  if (kinds.includes(requested)) {
    // Setting an explicit kind restores the standard non-pinned cycling behaviour.
    // Setting "off" clears both the pane and the pin because a hidden pin is invisible state.
    if (session) {
      session.paneKind = requested;
      session.panePinned = false;
    }
    print(`${colors.c || ""}side pane: ${requested}${colors.reset || ""}`);
    return "handled";
  }
  print(`usage: /pane [todos|diff|files|mcp|context|off|pin|unpin] (current: ${session?.paneKind || "off"})`);
  return "handled";
}

export async function handleSessionCommand(ctx, cmd, args) {
  if (cmd === "/todos") return handleTodos(ctx, args);
  if (cmd === "/pane") return handlePane(ctx, args);
  if (cmd === "/keybind" || cmd === "/keybinds") return handleKeybindCommand(ctx, args);
  if (cmd === "/tabs" || cmd === "/tab") return handleTabs(ctx, args);
  const { rl, session, C: colors = C } = ctx;
  const { print } = createPrinter(ctx);
  switch (cmd) {
    case "/new":
      await startNewSession(rl, session, args.join(" "));
      clearTodos();
      session.state = await state();
      return "refresh";
    case "/restart":
      return "restart";
    case "/session":
    case "/sessions":
    case "/resume":
      if (!args.length) await resumePicker(rl, session);
      else await resumeInto(rl, session, args.join(" "));
      clearTodos();
      return "refresh";
    case "/rename": {
      const name = args.join(" ").trim();
      if (!name) print("usage: /rename <short-name>");
      else {
        const renamed = await renameCurrentSessionName(session, name);
        print(`${colors.c}✓ session name: @${renamed}${colors.reset}`);
      }
      return "handled";
    }
    case "/title": {
      const title = args.join(" ").trim();
      if (!title) print("usage: /title <session name>");
      else {
        const renamed = await renameCurrentSession(session, title);
        print(`${colors.c}✓ session title: ${renamed}${colors.reset}`);
      }
      return "handled";
    }
    case "/compact": {
      try {
        await persistSession(session);
        const res = await api("/api/v1/agent-sessions", {
          method: "POST",
          body: JSON.stringify({ action: "compact", id: session.agentSession.id }),
        });
        if (res?.error) {
          console.error(`${colors.err}${res.error}${colors.reset}`);
          return "handled";
        }
        if (res?.session) {
          session.agentSession = { ...session.agentSession, ...res.session };
          if (Array.isArray(res.session.history)) session.history = res.session.history;
        }
        const before = res?.beforeTokens ?? 0;
        const after = res?.afterTokens ?? before;
        if (res?.archived) {
          print(`${colors.c}compacted context: ${before} → ${after} tokens (archive written)${colors.reset}`);
        } else {
          const reason = res?.archiveReason || "context already minimal";
          print(`${colors.dim}${reason}: ${before} → ${after} tokens (no archive written)${colors.reset}`);
        }
      } catch (error) {
        console.error(`${colors.err}${error instanceof Error ? error.message : String(error)}${colors.reset}`);
      }
      return "handled";
    }
    case "/clear":
      clearTodos();
      Object.assign(session, { history: [], pendingSkill: null, activeSkill: null, lastInvokedSkill: null });
      rl.replaceHistory([]);
      await persistSession(session);
      print("conversation and prompt history cleared.");
      return "handled";
    case "/exit":
    case "/quit":
      return "exit";
    default:
      return null;
  }
}
