"use client";
// audit-allow-hex: VS-Code-dark editor chrome palette is the slice's design, not themable tokens.

import type { SaveState } from "../lib/use-editor";

export function StatusBar({
  path,
  ln,
  col,
  tabSize,
  dirty,
  saveState,
}: {
  path: string | null;
  ln: number;
  col: number;
  tabSize: number;
  dirty: boolean;
  saveState: SaveState;
}) {
  // Live host may reject writes; surface that distinctly from a clean save.
  const status =
    saveState === "error"
      ? "Read-only · saved locally"
      : dirty
        ? "● Unsaved"
        : "Saved";

  return (
    <footer className="flex min-h-6 shrink-0 items-center gap-3.5 border-t border-[#2a2a30] bg-[#16161a] px-3.5 [padding-bottom:var(--sai-bottom)] font-mono text-[11px] text-[#7d8590]">
      <span className="truncate">{path ?? "No file"}</span>
      {path ? (
        <>
          <span className="ml-auto">
            Ln {ln}, Col {col}
          </span>
          <span>Spaces: {tabSize}</span>
          <span className={saveState === "error" ? "text-warning" : undefined}>
            {status}
          </span>
        </>
      ) : null}
    </footer>
  );
}
