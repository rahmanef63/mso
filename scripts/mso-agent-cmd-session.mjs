import {
  persistSession,
  renameCurrentSession,
  renameCurrentSessionName,
  resumeInto,
  startNewSession,
  resumePicker,
} from "./mso-agent-session-ui.mjs";
import { api, state } from "./mso-agent-api.mjs";
import { C } from "./mso-agent-runtime.mjs";
import { clearTodos, formatTodoBlock, latestTodos } from "./mso-agent-todos.mjs";
import { handleKeybindCommand } from "./mso-agent-keybinds.mjs";

export async function handleTodos(ctx, args = []) {
  const { C: colors = C } = ctx;
  const state = latestTodos();
  if (!state || (!state.items?.length && !state.summary)) {
    console.log("no todo list in this session yet: the agent writes one with todo_write");
    return "handled";
  }
  const showAll = args.includes("--all");
  const maxItems = showAll ? Number.POSITIVE_INFINITY : 12;
  const block = formatTodoBlock(state, { colors, maxItems });
  if (block) console.log(block);
  else console.log("no todo list in this session yet: the agent writes one with todo_write");
  return "handled";
}

export async function handleSessionCommand(ctx, cmd, args) {
  if (cmd === "/todos") {
    return handleTodos(ctx, args);
  }
  if (cmd === "/keybind" || cmd === "/keybinds") {
    return handleKeybindCommand(ctx, args);
  }
  const { rl, session, C: colors = C } = ctx;
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
      if (!name) console.log("usage: /rename <short-name>");
      else {
        const renamed = await renameCurrentSessionName(session, name);
        console.log(`${colors.c}✓ session name: @${renamed}${colors.reset}`);
      }
      return "handled";
    }
    case "/title": {
      const title = args.join(" ").trim();
      if (!title) console.log("usage: /title <session name>");
      else {
        const renamed = await renameCurrentSession(session, title);
        console.log(`${colors.c}✓ session title: ${renamed}${colors.reset}`);
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
          console.log(`${colors.c}compacted context: ${before} → ${after} tokens (archive written)${colors.reset}`);
        } else {
          const reason = res?.archiveReason || "context already minimal";
          console.log(`${colors.dim}${reason}: ${before} → ${after} tokens (no archive written)${colors.reset}`);
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
      console.log("conversation and prompt history cleared.");
      return "handled";
    case "/exit":
    case "/quit":
      return "exit";
    default:
      return null;
  }
}
