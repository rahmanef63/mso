import { lazy } from "react";
import { SquareTerminal, Bot } from "lucide-react";
import type { AppDescriptor } from "@/features/appshell";

// LAZY, not a plain re-export. shell.manifest.ts imports this barrel eagerly to read
// the two AppDescriptors below, so `export { Terminal } from "./app"` pulled ./app —
// and with it xterm plus its ~3.9 KB stylesheet — into the shell's entry chunk, even
// though `load:` already code-splits the very same module. Every other app barrel
// exports the descriptor only. The single consumer wraps this in <Suspense>.
//
// This is NOT the window-content.tsx case CLAUDE.md warns about: that one must avoid
// Suspense because window opens come from a synchronous external store whose retry
// ping a suspending boundary misses. Here the boundary sits in an ordinary render
// path inside an already-open window.
export const Terminal = lazy(() =>
  import("./app").then((m) => ({ default: m.Terminal })),
);

export const osTerminalApp: AppDescriptor = {
  id: "os-terminal",
  title: "Terminal",
  icon: SquareTerminal,
  gradient: "linear-gradient(160deg,#3a3a40,#111114)",
  load: () => import("./app"),
  defaultSize: { w: 640, h: 400 },
};

// Claude Code — a PTY that auto-runs `claude --dangerously-skip-permissions`.
export const claudeCodeApp: AppDescriptor = {
  id: "claude-code",
  title: "Claude Code",
  icon: Bot,
  gradient: "linear-gradient(160deg,#d97757,#8a4a30)",
  load: () => import("./claude-code"),
  defaultSize: { w: 760, h: 480 },
};
