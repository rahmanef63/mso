"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PIN_THRESHOLD_PX = 80;

function resolveViewport(host: HTMLElement | null): HTMLElement | null {
  if (!host) return null;
  return host.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]") ?? host;
}

/**
 * Standard AI chat scroll behavior: stay pinned to the bottom while streaming
 * ONLY if the user has not scrolled up to read earlier output, and expose a
 * jump-to-bottom trigger when unpinned.
 */
export function useChatAutoScroll(dep: unknown) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const [showScrollDown, setShowScrollDown] = useState(false);

  useEffect(() => {
    const vp = resolveViewport(containerRef.current);
    if (!vp) return;
    const onScroll = () => {
      const distance = vp.scrollHeight - vp.scrollTop - vp.clientHeight;
      const pinned = distance <= PIN_THRESHOLD_PX;
      pinnedRef.current = pinned;
      setShowScrollDown(!pinned);
    };
    vp.addEventListener("scroll", onScroll, { passive: true });
    return () => vp.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!pinnedRef.current) return;
    const id = requestAnimationFrame(() => {
      const vp = resolveViewport(containerRef.current);
      if (vp) vp.scrollTop = vp.scrollHeight;
      else bottomRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
    });
    return () => cancelAnimationFrame(id);
  }, [dep]);

  const scrollToBottom = useCallback(() => {
    pinnedRef.current = true;
    setShowScrollDown(false);
    const vp = resolveViewport(containerRef.current);
    if (vp) vp.scrollTo({ top: vp.scrollHeight, behavior: "smooth" });
    else bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, []);

  return { containerRef, bottomRef, showScrollDown, scrollToBottom };
}

export function ScrollToBottomButton({
  visible,
  onClick,
  className,
}: {
  visible: boolean;
  onClick: () => void;
  className?: string;
}) {
  if (!visible) return null;
  return (
    <Button
      type="button"
      size="icon"
      variant="secondary"
      aria-label="Scroll to latest message"
      title="Scroll to bottom"
      onClick={onClick}
      className={cn(
        "absolute bottom-3 left-1/2 z-10 size-8 -translate-x-1/2 rounded-full border border-border bg-card/95 shadow-md [@media(pointer:coarse)]:size-11",
        className,
      )}
    >
      <ArrowDown className="size-4" />
    </Button>
  );
}
