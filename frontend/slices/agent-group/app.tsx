"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, RefreshCw, Users } from "lucide-react";
import type { AppProps } from "@/features/appshell";
import { AppFrame, openWindow } from "@/features/appshell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AgentGroupCard } from "./components/agent-group-card";
import { AgentGroupEditor } from "./components/agent-group-editor";
import { loadAgentGroups } from "./lib/api";
import type { AgentGroupsSnapshot, AgentGroupView } from "./types";

const empty: AgentGroupsSnapshot = { groups: [], revision: 0 };

export default function AgentGroupApp(_: AppProps) {
  const [snapshot, setSnapshot] = useState<AgentGroupsSnapshot>(empty);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState<AgentGroupView | "new" | null>(null);

  const request = useRef(0);
  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    try {
      const next = await loadAgentGroups();
      if (id !== request.current) return;
      setSnapshot(next);
      setError("");
    } catch (cause) {
      if (id === request.current) setError(cause instanceof Error ? cause.message : "Could not load agent groups.");
    } finally { if (id === request.current) setLoading(false); }
  }, []);

  useEffect(() => {
    const requestRef = request;
    const frame = requestAnimationFrame(() => void load());
    window.addEventListener("focus", load);
    return () => { requestRef.current++; cancelAnimationFrame(frame); window.removeEventListener("focus", load); };
  }, [load]);

  const toolbar = <div className="flex h-11 min-w-0 items-center gap-2 px-3">
    <div className="flex min-w-0 flex-1 items-center gap-2"><span className="text-sm font-semibold">Agent groups</span><Badge variant="outline">{snapshot.groups.length}</Badge></div>
    <Button size="icon" variant="ghost" aria-label="Refresh groups" onClick={() => void load()}><RefreshCw className="size-4"/></Button>
    <Button size="sm" onClick={() => setEditor("new")}><Plus className="mr-2 size-3"/>New group</Button>
  </div>;

  return <div data-slot="agent-group-feature" className="@container h-full min-h-0 min-w-0">
    <AppFrame safeArea={false} className="h-full min-w-0 bg-background" toolbar={toolbar} bodyClassName="overflow-hidden">
      <div className="h-full overflow-y-auto p-3 @min-[720px]:p-4">
        {error ? <div role="alert" className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div> : null}
        {snapshot.groups.length ? <div className="grid gap-3 @min-[900px]:grid-cols-2">
          {snapshot.groups.map((row) => <AgentGroupCard key={row.id} row={row} revision={snapshot.revision} onEdit={() => setEditor(row)} onReload={load}/>)}
        </div> : <Empty loading={loading} onAdd={() => setEditor("new")}/>}
      </div>
    </AppFrame>
    <AgentGroupEditor
      key={editor === "new" ? "new" : editor?.id ?? "closed"}
      open={editor !== null}
      onOpenChange={(open) => { if (!open) setEditor(null); }}
      row={editor && editor !== "new" ? editor : null}
      revision={snapshot.revision}
      latest={editor && editor !== "new" ? snapshot.groups.find(item => item.id === editor.id) : undefined}
      onSaved={load}
    />
  </div>;
}

function Empty({ loading, onAdd }: { loading: boolean; onAdd: () => void }) {
  return <div className="grid min-h-[55vh] place-items-center">
    <div className="w-full max-w-xl rounded-xl border bg-card p-5">
      <div className="flex items-start gap-3"><div className="grid size-10 place-items-center rounded-lg border bg-muted/40"><Users className="size-5"/></div><div>
        <h2 className="text-base font-semibold">{loading ? "Loading agent groups…" : "Let your agents talk to each other"}</h2>
        <p className="mt-1 text-sm text-muted-foreground">Group several Hermes profiles into one discussion. Each agent keeps its own persona and memory, replies in turn, and can mirror its voice into a Telegram group.</p>
      </div></div>
      {!loading ? <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={onAdd}><Plus className="mr-2 size-3"/>New group</Button>
        <Button variant="outline" onClick={() => openWindow("channels", "Channels")}>Open Channels</Button>
      </div> : null}
    </div>
  </div>;
}
