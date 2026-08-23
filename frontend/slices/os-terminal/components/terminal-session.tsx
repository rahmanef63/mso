"use client";

import { useState } from "react";
import { useOsApi } from "../lib/host";
import ExecTerminal from "./exec-terminal";
import PtyTerminal from "./pty-terminal";

export type TerminalSessionProps = {
  initialCommand?: string;
  initialCwd?: string;
};

// One terminal process/view. The tab workspace keeps these mounted so switching
// tabs never destroys an interactive PTY. Demo mode and PTY failures retain the
// existing one-shot terminal fallback.
export function TerminalSession({ initialCommand, initialCwd }: TerminalSessionProps) {
  const api = useOsApi();
  const [ptyError, setPtyError] = useState<string | null>(null);
  const [prevMode, setPrevMode] = useState(api.mode);

  if (prevMode !== api.mode) {
    setPrevMode(api.mode);
    setPtyError(null);
  }

  if (api.mode === "live" && ptyError === null) {
    return (
      <PtyTerminal
        onFallback={setPtyError}
        initialCommand={initialCommand}
        initialCwd={initialCwd}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {api.mode === "live" && ptyError !== null && (
        <div
          className="flex shrink-0 select-none items-center gap-2 px-2 py-1 text-[11px] font-semibold"
          style={{ color: "#fff", background: "#a14545" }}
        >
          <span className="min-w-0 flex-1 truncate">
            PTY unavailable: {ptyError} — basic exec mode
          </span>
          <button
            onClick={() => setPtyError(null)}
            className="shrink-0 rounded bg-white/15 px-2 py-0.5 hover:bg-white/25 [@media(pointer:coarse)]:min-h-[44px]"
          >
            Retry PTY
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1">
        <ExecTerminal initialCwd={initialCwd} />
      </div>
    </div>
  );
}
