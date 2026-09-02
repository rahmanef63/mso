"use client";

import { Terminal } from "./app";
import type { AppProps } from "@/features/appshell";

const BASE = "claude --dangerously-skip-permissions";

// POSIX single-quote — safe for spaces, $, backticks, quotes.
const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

// Build the `cd … &&` prefix for a folder's "Open with Claude Code". The path is
// `~`-relative (Files' home root), and single quotes would NOT expand a leading
// tilde, so expand it via the shell's $HOME (double-quoted) and single-quote the
// literal remainder. Absolute paths just get single-quoted whole.
function cdPrefix(cwd: string): string {
  if (cwd === "~") return `cd "$HOME" && `;
  if (cwd.startsWith("~/")) return `cd "$HOME"${sq(cwd.slice(1))} && `;
  return `cd ${sq(cwd)} && `;
}

// Claude Code app — opens a live PTY that immediately runs the Claude Code CLI
// with permission prompts skipped (`claude --dangerously-skip-permissions`): a
// one-tap agentic coding session on the host. A { cwd } payload ("Open with
// Claude Code" on a folder) cds into that folder first so the session is scoped
// to it. Falls back to the plain terminal banner if the PTY can't open (exec
// mode can't auto-run the CLI).
export default function ClaudeCodeApp({ payload }: AppProps) {
  const cwd =
    payload && typeof payload === "object" && "cwd" in payload
      ? (payload as { cwd?: unknown }).cwd
      : undefined;
  const initialCommand = typeof cwd === "string" && cwd ? cdPrefix(cwd) + BASE : BASE;
  return <Terminal initialCommand={initialCommand} tabbed={false} />;
}
