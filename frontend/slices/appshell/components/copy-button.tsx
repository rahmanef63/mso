"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { recordClip } from "../lib/clipboard";
import { toast } from "../lib/toast";

// The one copy control. Anything the user would otherwise select-and-retype — a device
// code, a verification URL, an install command, a path — gets this instead.
//
// Deliberately NOT copyClip() from lib/clipboard: that one fire-and-forgets the write
// (`void navigator.clipboard?.writeText`) and toasts "Copied" unconditionally, so on a
// non-secure origin or a denied permission it cheerfully claims success while the
// clipboard is untouched. Here the write is awaited and a failure says so.
//
// `history` exists because the clipboard panel PERSISTS what it records. A short-lived
// auth factor (an OAuth device code) must not be filed there, where it outlives the
// ~15 minutes it is valid and sits in a list the user browses later.
export function CopyButton({
  value,
  label,
  history = true,
  className,
}: {
  value: string;
  /** Names the thing, not the action: "Copy {label}" is the accessible name. */
  label: string;
  history?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    try {
      // Throws on an insecure origin or a denied permission — which is the case the
      // old helper silently swallowed.
      await navigator.clipboard.writeText(value);
    } catch {
      toast("Couldn't copy. Select the text and copy manually.");
      return;
    }
    if (history) recordClip(value);
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={copy}
      // The label changes with state so a screen reader announces the result; an icon
      // swap alone is invisible to one.
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      title={copied ? "Copied" : `Copy ${label}`}
      className={cn("size-8 shrink-0 text-muted-foreground hover:text-foreground [@media(pointer:coarse)]:size-11", className)}
    >
      {copied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
    </Button>
  );
}
