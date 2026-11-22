import { printDetailedStatus } from "./mso-agent-status.mjs";
import {
  permissionCompletionItems,
  permissionMode,
} from "./mso-agent-permissions.mjs";
import { handleDiffCommand } from "./mso-agent-diff.mjs";
import { handleFilesCommand } from "./mso-agent-files.mjs";
import { printSkills } from "./mso-agent-skills.mjs";
import { state } from "./mso-agent-api.mjs";
import { C } from "./mso-agent-runtime.mjs";
import { createPrinter } from "./mso-agent-print.mjs";

export async function handleInspectCommand(ctx, cmd, args) {
  const { rl, session, runCli, C: colors = C } = ctx;
  const { print } = createPrinter(ctx);
  switch (cmd) {
    case "/status":
    case "/context":
      printDetailedStatus(session, colors);
      return "handled";
    case "/diff":
      await handleDiffCommand(session, args);
      return "handled";
    case "/permission": {
      const direct = args.length ? permissionMode(args.join(" ")) : null;
      if (args.length && !direct) {
        print("usage: /permission [ask|auto-write|yolo]");
        return "handled";
      }
      if (direct) session.permission = direct.id;
      else {
        const selected = await rl.question(
          `${colors.blue}${colors.bold}permission ›${colors.reset} `,
          {
            history: false,
            complete: (value) => permissionCompletionItems(value),
            panelLabel: "permission mode",
            selectOnEnter: true,
            escapeCancels: true,
          },
        );
        if (selected)
          session.permission =
            permissionMode(selected)?.id || session.permission;
      }
      print(`permission ${session.permission}`);
      return "handled";
    }
    case "/statusbar": {
      const value = String(args[0] || "").toLowerCase();
      if (value === "off") session.statusBar = false;
      else if (value === "on") session.statusBar = true;
      else session.statusBar = !session.statusBar;
      print(`status bar ${session.statusBar ? "on" : "off"}`);
      return "handled";
    }
    case "/models":
      runCli(["models", ...args]);
      session.state = await state();
      return "refresh";
    case "/model":
      runCli(["model", ...args]);
      session.state = await state();
      return "refresh";
    case "/setup":
      runCli(["onboard"]);
      session.state = await state();
      return "refresh";
    case "/integrations":
      runCli(["integrations", ...args]);
      session.state = await state();
      return "refresh";
    case "/providers":
      runCli(["provider", "list"]);
      session.state = await state();
      return "refresh";
    case "/provider":
      if (!args[0])
        print("usage: /provider dokploy|cloudflare|hostinger");
      else runCli(["provider", "set", args[0]]);
      session.state = await state();
      return "refresh";
    case "/doctor":
      runCli(["doctor"]);
      return "handled";
    case "/tools":
      for (const tool of session.state.tools)
        print(`  ${String(tool.scope).padEnd(5)} ${tool.name}`);
      return "handled";
    case "/files":
      await handleFilesCommand(args, session);
      return "handled";
    case "/skills":
      printSkills(session, colors, args.join(" "));
      return "handled";
    default:
      return null;
  }
}
