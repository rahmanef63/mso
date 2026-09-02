"use client";

import { useCallback, useEffect, useState } from "react";
import { Brain, Trash2 } from "lucide-react";
import { toast } from "@/features/appshell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SettingsSection, SettingsRow, SettingsBlock } from "@/features/shell-settings";

type Memory = { id: string; text: string; createdAt: number };

// Alfa's cross-session memory + output token-saver. Facts are recalled into the
// system prompt (matched to the user's message); the token-saver appends a terse
// style. Both are host-side (server routes) — never local-only.
export function MemorySection() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [text, setText] = useState("");
  const [saver, setSaver] = useState("off");

  const load = useCallback(() => {
    fetch("/api/memory", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { memories: [] }))
      .then((d) => setMemories(d.memories ?? []))
      .catch(() => {});
    fetch("/api/config", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => c && setSaver(c.tokenSaver ?? "off"))
      .catch(() => {});
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    const t = text.trim();
    if (!t) return;
    const r = await fetch("/api/memory", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: t }),
    });
    if (!r.ok) {
      toast("Couldn’t save memory", { tone: "error" });
      return;
    }
    setText("");
    load();
  }
  async function remove(id: string) {
    await fetch(`/api/memory?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
    load();
  }
  async function setTokenSaver(v: string) {
    setSaver(v);
    await fetch("/api/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tokenSaver: v }),
    }).catch(() => {});
  }

  return (
    <SettingsSection
      icon={<Brain />}
      title="Alfa memory"
      footnote="Facts Alfa recalls across sessions (matched to your message), plus an optional terse output style. Stored on the server alongside your chat threads."
    >
      <SettingsRow label="Output style">
        <Select value={saver} onValueChange={setTokenSaver}>
          <SelectTrigger className="sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="off">Normal</SelectItem>
            <SelectItem value="caveman">Caveman (terse)</SelectItem>
            <SelectItem value="ponytail">Ponytail (lazy senior dev)</SelectItem>
          </SelectContent>
        </Select>
      </SettingsRow>
      <SettingsBlock className="flex gap-2">
        <Input
          placeholder="Remember a fact (e.g. “I deploy with bun run build + restart”)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void add();
          }}
        />
        <Button size="sm" onClick={add}>
          Add
        </Button>
      </SettingsBlock>
      {memories.length > 0 && (
        <SettingsBlock>
          <div className="divide-y divide-border rounded-lg border border-border">
            {memories.map((m) => (
              <div key={m.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1">{m.text}</span>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Delete memory"
                  onClick={() => remove(m.id)}
                  className="size-7 shrink-0 text-muted-foreground hover:text-destructive [@media(pointer:coarse)]:size-[44px]"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        </SettingsBlock>
      )}
    </SettingsSection>
  );
}
