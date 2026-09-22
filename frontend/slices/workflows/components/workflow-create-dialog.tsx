"use client";

import { useEffect, useState } from "react";
import { Plus, Sparkles, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormDrawer } from "@/features/appshell";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { aiSuggest, listTemplates } from "../lib/api";
import { parseWorkflowPackage, type WorkflowDefinition } from "../lib/portability";

export function WorkflowCreateDialog({
  onBlank,
  onTemplate,
  onAI,
  onImport,
  compact = false,
}: {
  onBlank: () => Promise<void>;
  onTemplate: (id: string) => Promise<void>;
  onAI: (definition: WorkflowDefinition) => Promise<void>;
  onImport: (definition: WorkflowDefinition) => Promise<void>;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"blank" | "templates" | "ai" | "import">("templates");
  const [templates, setTemplates] = useState<Array<{ id: string; title: string; description: string; tags: string[]; nodeCount: number }>>([]);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void listTemplates().then((rows) => { if (!cancelled) setTemplates(rows); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [open]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try { await fn(); setOpen(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Action failed"); }
    finally { setBusy(false); }
  };

  const importFile = async (file: File) => {
    if (file.size > 2 * 1024 * 1024) throw new Error("Workflow package exceeds 2 MiB");
    await onImport(parseWorkflowPackage(await file.text()));
  };

  return <>
    <Button size={compact ? "icon" : "sm"} variant="outline" className={compact ? "size-9 shrink-0" : ""} onClick={() => setOpen(true)} aria-label={compact ? "New workflow" : undefined}>
      {compact ? <Plus className="size-4"/> : "New"}
    </Button>
    <FormDrawer open={open} onOpenChange={setOpen} size="lg">
      <FormDrawer.Header>
        <FormDrawer.Title>Create workflow</FormDrawer.Title>
        <FormDrawer.Description>Blank graph, template, portable package, or AI-assisted draft. Secrets stay outside definitions.</FormDrawer.Description>
      </FormDrawer.Header>
      <FormDrawer.Body className="space-y-3">
        <Tabs><TabsList>{(["templates", "blank", "import", "ai"] as const).map((value) => <TabsTrigger key={value} active={tab === value} onClick={() => setTab(value)}>{value}</TabsTrigger>)}</TabsList></Tabs>
        {tab === "blank" ? <div className="rounded-lg border p-4"><p className="mb-3 text-sm text-muted-foreground">Start with Manual Trigger → Output.</p><Button disabled={busy} onClick={() => void run(onBlank)}>Create blank</Button></div> : null}
        {tab === "templates" ? <ScrollArea className="h-72"><div className="grid gap-2 sm:grid-cols-2">{templates.map((item) => <button key={item.id} type="button" disabled={busy} onClick={() => void run(() => onTemplate(item.id))} className="rounded-lg border p-3 text-left hover:bg-accent"><div className="text-sm font-semibold">{item.title}</div><p className="mt-1 text-xs text-muted-foreground">{item.description}</p><div className="mt-2 text-[10px] text-muted-foreground">{item.nodeCount} nodes · {item.tags.join(" · ")}</div></button>)}</div></ScrollArea> : null}
        {tab === "import" ? <div className="rounded-lg border border-dashed p-5 text-center">
          <Upload className="mx-auto size-6 text-muted-foreground"/>
          <p className="mt-2 text-sm font-medium">Import portable workflow JSON</p>
          <p className="mt-1 text-xs text-muted-foreground">Accepts MSO workflow packages or a compatible graph definition up to 2 MiB. Server validation still applies.</p>
          <label className="mt-4 inline-flex h-9 cursor-pointer items-center rounded-md border bg-background px-3 text-sm font-medium hover:bg-accent">
            Choose file
            <input type="file" className="sr-only" accept=".json,application/json" disabled={busy} onChange={(event) => {
              const file = event.target.files?.[0];
              event.currentTarget.value = "";
              if (file) void run(() => importFile(file));
            }}/>
          </label>
        </div> : null}
        {tab === "ai" ? <div className="space-y-3"><Textarea className="min-h-32" placeholder="Describe the workflow, triggers, branches, project/integration actions, and expected output…" value={prompt} onChange={(event) => setPrompt(event.target.value)}/><Button disabled={busy || !prompt.trim()} onClick={() => void run(async () => onAI(await aiSuggest(prompt)))}><Sparkles className="mr-2 size-4"/>Generate draft</Button></div> : null}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </FormDrawer.Body>
    </FormDrawer>
  </>;
}
