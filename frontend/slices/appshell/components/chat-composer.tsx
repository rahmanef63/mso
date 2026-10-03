"use client";

import { useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { ArrowUp, Send, Sparkles, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useActiveShell } from "../registry/shells";
import { useAlfaRunState } from "../lib/alfa-run-state";
import { alfaSources, subscribeAlfaSources, alfaSourcesVersion } from "../lib/alfa-sources";
import { mentionAt, applyMention, rankMentions, type MentionItem } from "../lib/mentions";

// THE composer. Every AI input in MSO renders this one — the Assistant app, the
// desktop right dock and the mobile Alfa sheet — so behaviour cannot drift between
// them. It used to live in the assistant slice while the sheet had its own bare
// <input>, which is exactly the duplication this replaces.
//
// Enter sends, Shift+Enter newlines, and the action button becomes Stop while
// streaming so the composer is never permanently locked.
//
// @ completes agents, / completes skills and tools. Both read from registered
// getters (appshell cannot see the assistant slice), and the completion state is
// LOCAL — typing never touches the shared conversation store, so the message list
// does not re-render on a keystroke.
export function ChatComposer({
  onSend,
  streaming,
  onStop,
  placeholder,
}: {
  onSend: (text: string) => void;
  streaming: boolean;
  onStop: () => void;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const canSend = value.trim().length > 0 && !streaming;
  const ios = useActiveShell().id === "ios";
  const run = useAlfaRunState();
  // Re-render when a source's data lands asynchronously: the consumer module is
  // imported on this component's first render, and its skills fetch starts on the
  // first `/`. `items` below is computed during render, so without this the new
  // rows would only appear on the user's next keystroke.
  useSyncExternalStore(subscribeAlfaSources, alfaSourcesVersion, () => 0);
  const agentName = alfaSources().activeAgentName?.() ?? null;

  const query = dismissed ? null : mentionAt(value, caret);
  // Computed every render on purpose. A useMemo keyed on the query could never
  // invalidate when the async skill fetch landed, so typing "/" in the first seconds
  // after boot showed the tools and NONE of the ~89 skills until a remount. Ranking
  // a ~110-item list by prefix is nothing next to a keystroke.
  const items: MentionItem[] = query
    ? rankMentions(
        query.kind === "agent" ? alfaSources().agents() : alfaSources().commands(),
        query.query,
      )
    : [];
  const open = !!query && items.length > 0;

  function sync(el: HTMLTextAreaElement) {
    const nextCaret = el.selectionStart ?? el.value.length;
    // Escape dismissed the menu for THIS trigger; typing another character must not
    // undo that. Re-arm only once the caret leaves the dismissed trigger entirely.
    const still = mentionAt(el.value, nextCaret);
    if (!still || !query || still.start !== query.start) setDismissed(false);
    setValue(el.value);
    setCaret(nextCaret);
    setActive(0);
  }

  function choose(item: MentionItem) {
    if (!query) return;
    item.onPick?.();
    const next = applyMention(value, query, item.insert);
    setValue(next.text);
    setCaret(next.caret);
    setActive(0);
    // Put the caret back where the completion left it, after React commits.
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.caret, next.caret);
    });
  }

  function submit() {
    if (!canSend) return;
    onSend(value.trim());
    setValue("");
    setCaret(0);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // The popup owns these keys while it is open — Enter ACCEPTS a completion
    // rather than sending, which is the one real conflict in this design.
    if (open) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => (i + 1) % items.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => (i - 1 + items.length) % items.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        choose(items[active]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissed(true); // keep the text, just close the menu
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !streaming) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="relative border-t bg-background/60 p-3 [padding-bottom:calc(0.75rem+var(--sai-bottom))]">
      {open ? (
        <ul
          role="listbox"
          aria-label={query?.kind === "agent" ? "Agents" : "Skills and tools"}
          className="absolute bottom-full left-3 right-3 z-10 mb-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
        >
          {items.map((it, i) => (
            <li key={it.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                // pointerDown, not click: click fires after blur, which would close
                // the menu and drop the selection on touch.
                onPointerDown={(e) => {
                  e.preventDefault();
                  choose(it);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-xs [@media(pointer:coarse)]:py-2.5",
                  i === active ? "bg-accent text-accent-foreground" : "text-foreground",
                )}
              >
                <span className="font-medium">{it.label}</span>
                {it.hint ? <span className="truncate text-[10px] text-muted-foreground">{it.hint}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {/* Who will answer THIS message. Switching agent from the sheet is global and
          persistent, so doing it with no feedback at all would be the worst kind of
          hidden state. Rendered here because this subtree re-renders on the pick. */}
      {agentName ? (
        <p className="mb-1.5 flex items-center gap-1 text-[10px] text-muted-foreground">
          <Sparkles className="size-3 shrink-0" aria-hidden />
          <span className="truncate">
            Answering as <span className="font-medium text-foreground">{agentName}</span>
          </span>
        </p>
      ) : null}

      {/* iOS = iMessage pill: the send FAB nests inside the --fill rounded pill. */}
      <div className={cn("flex items-end gap-2", ios && "gap-1.5 rounded-full border-0 bg-[var(--kbd-field,#f2f2f7)] py-1 pl-3.5 pr-1 shadow-[inset_0_0_8px_rgba(0,0,0,0.05)]")}>
        <Textarea
          ref={ref}
          value={value}
          onChange={(e) => sync(e.currentTarget)}
          onKeyUp={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onClick={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={streaming ? (run?.status === "waiting" ? "Waiting for your approval…" : run?.status === "stopped" ? "Stopping the run…" : "Alfa is working…") : (placeholder ?? "Message Alfa…  @agent  /skill")}
          className={cn(
            "max-h-32 min-h-9 flex-1 resize-none scrollbar-thin",
            ios && "min-h-8 border-0 bg-transparent px-0 py-1.5 text-[17px] tracking-[-0.02em] shadow-none focus-visible:ring-0",
          )}
        />
        {streaming ? (
          <Button type="button" size="icon" variant="secondary" onClick={onStop} aria-label="Stop generating" className={cn("flex-none [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11", ios ? "size-[30px] rounded-full" : "size-9")}>
            <Square className={ios ? "size-3 fill-current" : "size-4 fill-current"} />
          </Button>
        ) : (
          <Button type="button" size="icon" onClick={submit} disabled={!canSend} aria-label="Send message" className={cn("flex-none [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11", ios ? "size-[30px] rounded-full" : "size-9")}>
            {ios ? <ArrowUp className="size-4" /> : <Send className="size-4" />}
          </Button>
        )}
      </div>
    </div>
  );
}
