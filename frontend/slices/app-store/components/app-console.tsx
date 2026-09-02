"use client";

import { useRef, useState } from "react";
import { Loader2, Play, Trash2 } from "lucide-react";
import { useOsApi } from "../lib/host";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { AppManifest } from "./runtime-app-types";

type OutLine = { kind: "out" | "err" | "exit" | "sys"; text: string };

// Terminal-style runner for installed command/script apps. Calls the one-shot
// OsApi exec contract; in mock mode the agent returns canned text — surfaced as
// a notice so the user knows it isn't hitting the real host.
export function AppConsole({ m }: { m: AppManifest }) {
  const api = useOsApi();
  const [lines, setLines] = useState<OutLine[]>([]);
  const [running, setRunning] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const append = (next: OutLine[]) =>
    setLines((prev) => {
      const merged = [...prev, ...next];
      queueMicrotask(() => {
        const el = bodyRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
      return merged;
    });

  const toLines = (text: string, kind: OutLine["kind"]): OutLine[] =>
    text
      .replace(/\n$/, "")
      .split("\n")
      .filter((_, i, a) => !(a.length === 1 && a[0] === ""))
      .map((text) => ({ kind, text }));

  const onRun = async () => {
    if (running || !m.entry) return;
    setRunning(true);
    append([{ kind: "sys", text: `$ ${m.entry}` }]);
    try {
      const r = await api.exec.run(m.entry);
      const out: OutLine[] = [];
      if (r.stdout) out.push(...toLines(r.stdout, "out"));
      if (r.stderr) out.push(...toLines(r.stderr, "err"));
      out.push({ kind: "exit", text: `exit ${r.code}` });
      append(out);
    } catch (e) {
      append([{ kind: "err", text: e instanceof Error ? e.message : String(e) }]);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <h2 className="mr-auto truncate text-sm font-bold">{m.title}</h2>
        <span className="rounded-md bg-secondary px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
          {m.runtime}
        </span>
        <Button size="sm" onClick={onRun} disabled={running || !m.entry}>
          {running ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
          {running ? "Running" : "Run"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setLines([])}
          disabled={running || lines.length === 0}
        >
          <Trash2 className="size-3.5" /> Clear
        </Button>
      </header>

      <div className="truncate border-b border-border bg-secondary/40 px-3 py-1 font-mono text-[11px] text-muted-foreground">
        entry: {m.entry || "—"}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div ref={bodyRef} className="p-3 font-mono text-xs leading-relaxed">
          {api.mode === "mock" && (
            <p className="mb-2 text-[11px] text-muted-foreground">
              mock mode — output is simulated; connect the host agent to run for real.
            </p>
          )}
          {lines.length === 0 && !running && (
            <p className="text-muted-foreground">Press Run to execute {m.runtime} app.</p>
          )}
          {lines.map((l, i) => (
            <div
              key={i}
              className={
                l.kind === "err"
                  ? "whitespace-pre-wrap text-destructive"
                  : l.kind === "exit"
                    ? "whitespace-pre-wrap text-muted-foreground"
                    : l.kind === "sys"
                      ? "whitespace-pre-wrap text-[var(--accent)]"
                      : "whitespace-pre-wrap text-foreground"
              }
            >
              {l.text}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
