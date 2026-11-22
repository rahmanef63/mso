"use client";

import type { AppProps } from "@/features/appshell";
import { TerminalSession, type TerminalSessionProps } from "./components/terminal-session";
import { TerminalTabs } from "./components/terminal-tabs";

export type TerminalProps = TerminalSessionProps & {
  /** Set false for single-purpose shells such as Claude Code. */
  tabbed?: boolean;
  /** Trailing controls rendered inside the tab strip, so an embedding surface can add
   *  one icon without paying for another full-width bar above the terminal. */
  actions?: React.ReactNode;
};

// Public terminal surface. Normal Terminal and embedded Code terminals get a
// persistent tab workspace; focused tool shells can opt out with tabbed=false.
export function Terminal({ initialCommand, initialCwd, tabbed = true, actions, notice }: TerminalProps) {
  if (!tabbed) return <TerminalSession initialCommand={initialCommand} initialCwd={initialCwd} notice={notice} />;
  return <TerminalTabs initialCommand={initialCommand} initialCwd={initialCwd} actions={actions} notice={notice} />;
}

export default function TerminalApp({ payload }: AppProps) {
  const row = payload && typeof payload === "object" ? payload as { initialCwd?: unknown; initialCommand?: unknown } : undefined;
  const initialCwd = typeof row?.initialCwd === "string" && row.initialCwd ? row.initialCwd : undefined;
  const initialCommand = typeof row?.initialCommand === "string" && row.initialCommand ? row.initialCommand : undefined;
  return <Terminal initialCwd={initialCwd} initialCommand={initialCommand} />;
}
