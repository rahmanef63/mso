"use client";

import { useEffect, useState } from "react";
import { BrainCircuit } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { WorkflowLearningRecipeSummary } from "../lib/api";

type Page = { recipes: Array<WorkflowLearningRecipeSummary & { archived?: boolean; graphReceipt?: { state: string; warning?: string } }>; total: number; offset: number; nextOffset?: number; warnings: string[]; scope: string };

export function WorkflowLearningPanel({ sessionLabel }: { sessionLabel: string }) {
  const [offset, setOffset] = useState(0), [nonce, setNonce] = useState(0);
  const [result, setResult] = useState<{ key: string; page?: Page; error?: string } | null>(null);
  const key = `${sessionLabel}:${offset}:${nonce}`;
  const page = result?.key === key ? result.page : undefined;
  const error = result?.key === key ? result.error : undefined;
  const loading = result?.key !== key;
  useEffect(() => {
    let alive = true;
    const params = new URLSearchParams({ learning: "1", session_label: sessionLabel, include_archived: "1", offset: String(offset), limit: "20" });
    void fetch(`/api/v1/workflows?${params}`, { cache: "no-store" }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `Learning unavailable (${response.status})`);
      return body as Page;
    }).then(value => { if (alive) setResult({ key, page: value }); }, (cause: unknown) => {
      if (alive) setResult({ key, error: cause instanceof Error ? cause.message : "Learning could not be loaded" });
    });
    return () => { alive = false; };
  }, [key, sessionLabel, offset]);
  return <section data-slot="session-self-improve" className="space-y-2 border-t pt-3">
    <h3 className="flex items-center gap-1.5 text-xs font-semibold"><BrainCircuit className="size-3.5" />Self-improve</h3>
    {loading ? <p className="text-xs text-muted-foreground">Loading linked active and archived recipes…</p> : null}
    {error ? <div role="alert" className="space-y-2 text-xs text-destructive-text"><p>{error}. This is a loading failure, not proof that the session was not learned.</p><Button size="sm" variant="outline" onClick={() => setNonce(value => value + 1)}>Retry learning</Button></div> : null}
    {page ? <>
      <p className="text-xs text-muted-foreground">{page.total} linked recipes · active and archived. {page.scope}</p>
      {page.warnings.map(warning => <p key={warning} className="text-xs text-destructive-text">{warning}</p>)}
      {page.recipes.map(recipe => <div key={recipe.id} className="space-y-1 rounded-lg border p-2.5">
        <div className="flex flex-wrap gap-1"><Badge variant="outline">{recipe.stage}</Badge>{recipe.archived ? <Badge variant="secondary">Archived</Badge> : null}</div>
        <p className="text-xs font-medium">{recipe.intent}</p>
        <p className="text-xs text-muted-foreground">{recipe.attempts} attempts · {recipe.successRate}% success</p>
        <div className="flex flex-wrap gap-1">{recipe.sourceSessions.filter(source => source.label === sessionLabel).slice(0, 8).map(source => <code key={`${source.label}:${source.actionRef}`} className="text-[10px]">{source.actionRef}</code>)}</div>
        {recipe.graphReceipt?.warning ? <p className="text-xs text-destructive-text">{recipe.graphReceipt.warning}</p> : null}
        <p className="text-[10px] text-muted-foreground">Recipe availability does not authorize evidence deletion or prove this whole session has been reviewed. Skill/tool promotion remains explicit through Tool Forge.</p>
      </div>)}
      {!page.recipes.length ? <p className="text-xs text-muted-foreground">No link was found in retained recipe provenance. This does not prove that no memory was saved.</p> : null}
      <div className="flex gap-2"><Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 20))}>Previous</Button><Button size="sm" variant="outline" disabled={page.nextOffset === undefined} onClick={() => setOffset(page.nextOffset ?? offset)}>Next</Button></div>
    </> : null}
  </section>;
}
