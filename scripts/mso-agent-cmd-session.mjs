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

export async function handleSessionCommand(ctx, cmd, args) {
  const { rl, session, C: colors = C } = ctx;
  switch (cmd) {
    case "/new":
      await startNewSession(rl, session, args.join(" "));
      session.state = await state();
      return "refresh";
    case "/restart":
      return "restart";
    case "/session":
    case "/sessions":
    case "/resume":
      if (!args.length) await resumePicker(rl, session);
      else await resumeInto(rl, session, args.join(" "));
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
