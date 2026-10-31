import {
  persistSession,
  renameCurrentSession,
  renameCurrentSessionName,
  resumeInto,
  startNewSession,
  resumePicker,
} from "./mso-agent-session-ui.mjs";
import { api, listCliSessions, state } from "./mso-agent-api.mjs";
import { C } from "./mso-agent-runtime.mjs";
import { clearTodos, formatTodoBlock, latestTodos } from "./mso-agent-todos.mjs";
import { handleKeybindCommand } from "./mso-agent-keybinds.mjs";
import { visibleSessionRows } from "./mso-agent-sessions.mjs";
import { tabsToSwitch } from "./mso-agent-chrome.mjs";
import { cyclePane, paneKinds } from "./mso-agent-pane.mjs";
import { createPrinter } from "./mso-agent-print.mjs";

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
  const rows = visibleSessionRows(await listCliSessions(20));
  if (!args.length) {
    if (!rows.length) {
      print("No active sessions.");
      return "handled";
    }
    print(`${colors.bold || ""}Sessions${colors.reset || ""}`);
    rows.forEach((row, idx) => {
      const isCurrent = String(row.id) === String(session?.agentSession?.id);
      const mark = isCurrent ? `${colors.blue || ""}${colors.bold || ""}●${colors.reset || ""}` : " ";
      const name = `@${row.name || "agent"}`;
      const title = row.title || "MSO Agent session";
      print(`  ${mark} ${idx + 1}. ${name} · ${title}${isCurrent ? " (current)" : ""}`);
    });
    return "handled";
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
    const next = cyclePane(current);
    if (session) session.paneKind = next;
    print(`${colors.c || ""}side pane: ${next}${colors.reset || ""}`);
    return "handled";
  }
  const requested = String(args[0]).toLowerCase();
  if (kinds.includes(requested)) {
    if (session) session.paneKind = requested;
    print(`${colors.c || ""}side pane: ${requested}${colors.reset || ""}`);
    return "handled";
  }
  print(`usage: /pane [todos|diff|files|off] (current: ${session?.paneKind || "off"})`);
  return "handled";
}

export async function handleSessionCommand(ctx, cmd, args) {
  if (cmd === "/todos") {
    return handleTodos(ctx, args);
  }
  if (cmd === "/pane") {
    return handlePane(ctx, args);
  }
  if (cmd === "/keybind" || cmd === "/keybinds") {
    return handleKeybindCommand(ctx, args);
  }
  if (cmd === "/tabs" || cmd === "/tab") {
    return handleTabs(ctx, args);
  }
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
      Object.assign(session, {
        history: [],
        pendingSkill: null,
        activeSkill: null,
        lastInvokedSkill: null,
      });
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
