"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function McpCopyField({ label, value, multiline = false }: { label: string; value: string; multiline?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1.5">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      <div className="flex items-start gap-2 rounded-lg border border-border/70 bg-secondary/45 p-2.5">
        <code className={cn("min-w-0 flex-1 break-all font-mono text-[11px] leading-relaxed text-secondary-foreground", multiline && "whitespace-pre-wrap break-words")}>{value}</code>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 [@media(pointer:coarse)]:size-11"
          aria-label={`Copy ${label}`}
          onClick={() => void navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          })}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
      </div>
    </div>
  );
}
