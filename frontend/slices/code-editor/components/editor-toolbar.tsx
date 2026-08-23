"use client";
// audit-allow-hex: VS-Code-dark editor chrome palette is the slice's design, not themable tokens.

import { Eye, PanelLeft, Save, SquareTerminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Lang } from "../lib/highlight";

export function EditorToolbar({
  lang,
  dirty,
  canSave,
  canPreview,
  previewing,
  terminalOpen,
  onOpenExplorer,
  onTogglePreview,
  onToggleTerminal,
  onSave,
}: {
  lang: Lang;
  dirty: boolean;
  canSave: boolean;
  canPreview: boolean;
  previewing: boolean;
  terminalOpen: boolean;
  onOpenExplorer: () => void;
  onTogglePreview: () => void;
  onToggleTerminal: () => void;
  onSave: () => void;
}) {
  return (
    <header className="flex min-w-0 items-center gap-2 border-b border-[#2a2a30] bg-[#16161a] px-2 py-1.5">
      {/* Explorer opens as a left Sheet when the rail is hidden (narrow). */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        title="Open Explorer"
        aria-label="Open Explorer"
        onClick={onOpenExplorer}
        className={cn(
          "size-7 place-items-center rounded-md p-0 text-[#9aa0aa] hover:bg-[#2a2a30]",
          "hidden @max-[600px]:grid [@media(pointer:coarse)]:size-[44px]",
        )}
      >
        <PanelLeft className="size-4" />
      </Button>
      <div className="ml-auto flex items-center gap-2">
        <Badge variant="secondary" className="font-mono text-[10px] uppercase @max-[420px]:hidden">
          {lang}
        </Badge>
        {canPreview && (
          <Button
            type="button"
            variant={previewing ? "default" : "secondary"}
            size="sm"
            onClick={onTogglePreview}
            title="Toggle live preview (CDN deps)"
            aria-pressed={previewing}
            className="[@media(pointer:coarse)]:h-[44px]"
          >
            <Eye />
            <span className="@max-[480px]:hidden">Preview</span>
          </Button>
        )}
        <Button
          type="button"
          variant={terminalOpen ? "default" : "secondary"}
          size="sm"
          onClick={onToggleTerminal}
          title="Toggle integrated terminal"
          aria-pressed={terminalOpen}
          className="[@media(pointer:coarse)]:h-[44px]"
        >
          <SquareTerminal />
          <span className="@max-[480px]:hidden">Terminal</span>
        </Button>
        <Button size="sm" onClick={onSave} disabled={!canSave || !dirty} className="[@media(pointer:coarse)]:h-[44px]">
          <Save />
          <span className="@max-[480px]:hidden">Save</span>
        </Button>
      </div>
    </header>
  );
}
