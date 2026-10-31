import process from "node:process";
import { C } from "./mso-agent-runtime.mjs";
import { safeErrorSummary } from "./mso-agent-errors.mjs";
import { toggleReasoning } from "./mso-agent-reasoning.mjs";
import { applyTheme, currentThemeName, themeNames } from "./mso-agent-ui.mjs";
import { createQueue, enqueue, queueClear, queueList } from "./mso-agent-queue.mjs";
import { createStash, stashClear, stashList, stashPop, stashPush } from "./mso-agent-stash.mjs";
import { uploadSessionImage } from "./mso-agent-image.mjs";
import { createPrinter } from "./mso-agent-print.mjs";

export const SHARE_UNAVAILABLE_MESSAGE =
  "/share is unavailable because the server exposes only download of existing shares.";

export function buildExportArgv(refOrArgs, maybeOut) {
  if (Array.isArray(refOrArgs)) {
    const argv = ["session", "export", ...refOrArgs.filter(Boolean)];
    if (maybeOut && !argv.includes("--out")) argv.push("--out", String(maybeOut));
    return argv;
  }
  if (refOrArgs && typeof refOrArgs === "object") {
    const argv = ["session", "export"];
    if (refOrArgs.ref) argv.push(String(refOrArgs.ref));
    const out = refOrArgs.out || maybeOut;
    if (out) argv.push("--out", String(out));
    return argv;
  }
  const argv = ["session", "export"];
  if (refOrArgs === "--out") {
    if (maybeOut) argv.push("--out", String(maybeOut));
    return argv;
  }
  if (refOrArgs) argv.push(String(refOrArgs));
  if (maybeOut) argv.push("--out", String(maybeOut));
  return argv;
}

export async function handleParityCommand(ctx, cmd, args) {
  const { session, runCli, C: colors = C } = ctx;
  const { print } = createPrinter(ctx);
  switch (cmd) {
    case "/export": {
      try {
        const outIdx = args.indexOf("--out");
        const outFile = outIdx !== -1 && args[outIdx + 1] ? args[outIdx + 1] : null;
        const code = runCli(buildExportArgv(args));
        if (code === 0) {
          if (outFile) print(`session exported to ${outFile}.`);
          else print("session export written to stdout.");
        }
      } catch (error) {
        console.error(`${colors.err}${safeErrorSummary(error)}${colors.reset}`);
      }
      return "handled";
    }
    case "/share": {
      try {
        // Server exposes only download of existing temp shares; no route creates them.
        print(SHARE_UNAVAILABLE_MESSAGE);
      } catch (error) {
        console.error(`${colors.err}${safeErrorSummary(error)}${colors.reset}`);
      }
      return "handled";
    }
    case "/reasoning": {
      session.showReasoning = toggleReasoning(session.showReasoning, args[0]);
      print(`reasoning ${session.showReasoning ? "on" : "off"}`);
      return "handled";
    }
    case "/theme": {
      // Per-process UI presentation state only; server does not own terminal styling.
      const target = String(args[0] || "").trim().toLowerCase();
      if (!target || target === "status") {
        const current = currentThemeName();
        const names = themeNames().join(", ");
        const disabled = Boolean(process.env.NO_COLOR || !process.stdout.isTTY);
        const reason = disabled ? "colour disabled (NO_COLOR or not a TTY)" : "";
        if (reason) print(`${colors.bold}theme ${current}${colors.reset} ${colors.dim}(${reason}) · available: ${names}${colors.reset}`);
        else print(`${colors.bold}theme ${current}${colors.reset} ${colors.dim}· available: ${names}${colors.reset}`);
        return "handled";
      }
      const result = applyTheme(target);
      if (!result.changed && result.reason) print(`${colors.dim}${result.reason}${colors.reset}`);
      else print(`${colors.bold}theme ${result.theme}${colors.reset}`);
      return "handled";
    }
    case "/queue": {
      const queue = session.queue || (session.queue = createQueue());
      const sub = args[0]?.toLowerCase();
      if (!args.length || (args.length === 1 && sub === "list")) {
        const items = queueList(queue);
        if (!items.length) print("queue empty");
        else items.forEach((item, index) => print(`${index + 1}. ${item}`));
        return "handled";
      }
      if (args.length === 1 && sub === "clear") {
        const dropped = queueClear(queue);
        print(`cleared ${dropped} queued ${dropped === 1 ? "item" : "items"}.`);
        return "handled";
      }
      if (args.length === 1 && sub === "run") {
        return "drain";
      }
      const text = args.join(" ").trim();
      const res = enqueue(queue, text);
      if (!res.ok) {
        if (res.capped) print(`queue full (cap is ${res.cap} items)`);
        return "handled";
      }
      print(`queued (${res.count} pending)`);
      return "handled";
    }
    case "/stash": {
      const stash = session.stash || (session.stash = createStash());
      const sub = args[0]?.toLowerCase();
      if (!args.length || (args.length === 1 && sub === "list")) {
        const items = stashList(stash);
        if (!items.length) print("stash empty");
        else items.forEach((item, index) => print(`${index + 1}. ${item}`));
        return "handled";
      }
      if (args.length === 1 && sub === "pop") {
        const text = stashPop(stash);
        if (!text) {
          print("stash empty");
          return "handled";
        }
        print(text);
        print("pop returned to the prompt is not automatic; prompt was printed, not inserted.");
        return "handled";
      }
      if (args.length === 1 && sub === "clear") {
        const dropped = stashClear(stash);
        print(`cleared ${dropped} stashed ${dropped === 1 ? "item" : "items"}.`);
        return "handled";
      }
      const text = args.join(" ").trim();
      const res = stashPush(stash, text);
      if (!res.ok) {
        if (res.capped) print(`stash full (cap is ${res.cap} items)`);
        return "handled";
      }
      print(`stashed (${res.count})`);
      return "handled";
    }
    case "/image": {
      const filePath = args.join(" ").trim();
      if (!filePath) {
        print("usage: /image <path>");
        return "handled";
      }
      if (!session?.agentSession?.artifacts?.directory) {
        print("session artifacts directory is unavailable; cannot attach image.");
        return "handled";
      }
      try {
        const uploaded = await uploadSessionImage(session, filePath);
        const images = session.pendingImages || (session.pendingImages = []);
        images.push(uploaded);
        print(`attached for next prompt (${images.length})`);
      } catch (err) {
        print(`image upload failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      return "handled";
    }
    default:
      return null;
  }
}
