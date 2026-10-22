"use client";

import { useState } from "react";
import { Copy, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UpdateConflictReport } from "@/lib/host/update-conflict";
import { updateConflictPrompt } from "@/lib/host/update-conflict";

/**
 * What the read-only preflight found when the checkout is dirty or diverged.
 * Safe means the update keeps the user's work; unsafe means it names the files and
 * hands over a prompt an AI agent can resolve immediately.
 */
export function UpdateConflictCard({
  conflict,
  target,
  current,
}: {
  conflict: UpdateConflictReport;
  target: string;
  current: string;
}) {
  const [copied, setCopied] = useState(false);
  const files = conflict.safe
    ? conflict.carried
    : conflict.conflicted.length
      ? conflict.conflicted
      : conflict.overlap;

  return (
    <div className="space-y-2 rounded-md border border-border/60 bg-background/70 p-3">
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
        <TriangleAlert className="size-3.5" />
        {conflict.safe
          ? "Your local changes carry over cleanly"
          : "This update would collide with your local changes"}
      </p>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {conflict.safe
          ? "Nothing to resolve: replaying them on top of the new code is a plain merge."
          : "Resolve these before updating; the update will not overwrite them silently."}
      </p>
      {files.length > 0 && (
        <ul className="space-y-0.5 font-mono text-[10px] text-foreground/85">
          {files.slice(0, 20).map((file) => (
            <li key={file} className="break-all">{file}</li>
          ))}
          {files.length > 20 && <li>+{files.length - 20} more</li>}
        </ul>
      )}
      {!conflict.safe && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-full"
          onClick={() => {
            void navigator.clipboard
              .writeText(updateConflictPrompt(conflict, { target, current }))
              .then(() => setCopied(true))
              .catch(() => setCopied(false));
          }}
        >
          <Copy className="size-4" /> {copied ? "Prompt copied" : "Copy AI fix prompt"}
        </Button>
      )}
    </div>
  );
}
