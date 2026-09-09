"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function McpCopyField({ label, value, multiline = false }: { label: string; value: string; multiline?: boolean }) {
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1.5">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <div className="flex items-start gap-2 rounded-lg border border-border/70 bg-secondary/45 p-2.5">
        <code className={cn("min-w-0 flex-1 [overflow-wrap:anywhere] font-mono text-sm leading-relaxed text-secondary-foreground", multiline && "whitespace-pre-wrap break-words")}>{value}</code>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 shrink-0"
          aria-label={`Copy ${label}`}
          onClick={() => void navigator.clipboard.writeText(value).then(() => {
            setError(false); setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          }).catch(() => setError(true))}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">Copy was unavailable. Select the text above to copy it manually.</p>}
      {copied && <span role="status" className="sr-only">Copied {label}</span>}
    </div>
  );
}
