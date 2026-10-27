"use client";

import { useRef, useState } from "react";
import { Bot, CornerDownLeft, Loader2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { AgentMsg } from "../../lib/host";
import { useEditorCommands } from "../../commands/use-editor-commands";
import { runEditorAgent } from "../../lib/ai-agent";

type Item =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; name: string; ok: boolean; result: string };

const SUGGESTIONS = [
  "Add a bold title 'Sale' centered near the top",
  "Make the canvas a 9:16 story",
  "Boost contrast and add a subtle drop shadow to the selected layer",
];

// In-editor AI assistant. The model drives the editor through the command
// registry (function calling) — every tool runs against the LIVE store, so
// changes appear on the canvas as the model works.
export function AiPanel() {
  const { tools, invoke } = useEditorCommands();
  const [items, setItems] = useState<Item[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const history = useRef<AgentMsg[]>([]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setErr(null);
    setDraft("");
    setItems((p) => [...p, { kind: "user", text: q }, { kind: "assistant", text: "" }]);
    history.current.push({ role: "user", text: q });
    setBusy(true);
    const setLastAssistant = (fn: (t: string) => string) =>
      setItems((p) => {
        const i = [...p];
        for (let k = i.length - 1; k >= 0; k--) if (i[k].kind === "assistant") { i[k] = { kind: "assistant", text: fn((i[k] as { text: string }).text) }; break; }
        return i;
      });
    try {
      const { history: next } = await runEditorAgent(history.current, tools, invoke, {
        onDelta: (c) => setLastAssistant((t) => t + c),
        onTool: (name, _input, outcome) =>
          setItems((p) => [...p, { kind: "tool", name, ok: outcome.ok, result: outcome.result }, { kind: "assistant", text: "" }]),
      });
      history.current = next;
      setItems((p) => p.filter((it) => !(it.kind === "assistant" && it.text === "")));
    } catch (e) {
      const m = e instanceof Error ? e.message : "failed";
      if (m.startsWith("no_api_key")) {
        const provider = m.split(":")[1] || "selected provider";
        setErr(`No API key for ${provider}. Add it in Settings → AI.`);
      } else {
        setErr(m);
      }
      setItems((p) => p.filter((it) => !(it.kind === "assistant" && it.text === "")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-2 p-3">
          {items.length === 0 && (
            <div className="space-y-2 pt-2 text-xs text-muted-foreground">
              <p className="flex items-center gap-1.5 font-medium"><Bot className="size-4" /> Ask the AI to edit for you.</p>
              {SUGGESTIONS.map((s) => (
                <Button key={s} type="button" variant="ghost" onClick={() => send(s)} className="block h-auto w-full justify-start whitespace-normal rounded border border-border px-2 py-1.5 text-left text-xs font-normal hover:bg-accent">
                  {s}
                </Button>
              ))}
            </div>
          )}
          {items.map((it, i) =>
            it.kind === "tool" ? (
              <div key={i} className={cn("flex items-center gap-1.5 rounded px-2 py-1 text-[11px]", it.ok ? "bg-muted text-muted-foreground" : "bg-destructive/10 text-destructive")}>
                <Wrench className="size-3 shrink-0" />
                <span className="font-mono">{it.name}</span>
                <span className="truncate opacity-80">: {it.result}</span>
              </div>
            ) : (
              <div key={i} className={cn("max-w-[90%] rounded-lg px-2.5 py-1.5 text-xs", it.kind === "user" ? "self-end bg-primary text-primary-foreground" : "self-start bg-card border border-border")}>
                {it.text || (busy && <Loader2 className="size-3.5 animate-spin" />)}
              </div>
            ),
          )}
        </div>
      </ScrollArea>
      {err && <p className="px-3 pb-1 text-[11px] text-destructive">{err}</p>}
      <form className="flex shrink-0 items-center gap-1.5 border-t border-border p-2" onSubmit={(e) => { e.preventDefault(); send(draft); }}>
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Tell the AI what to do…" disabled={busy} className="h-8 text-xs" />
        <Button type="submit" size="icon" aria-label="Send AI request" className="size-8 shrink-0" disabled={busy || !draft.trim()}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <CornerDownLeft className="size-4" />}
        </Button>
      </form>
    </div>
  );
}
