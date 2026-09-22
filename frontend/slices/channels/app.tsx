"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MessageSquareMore, Plus, Plug, RefreshCw, Workflow } from "lucide-react";
import type { AppProps } from "@/features/appshell";
import { AppFrame, openWindow } from "@/features/appshell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChannelCard } from "./components/channel-card";
import { ChannelEditor } from "./components/channel-editor";
import { loadChannels, loadChannelWorkflows } from "./lib/api";
import type { ChannelsSnapshot, ChannelView, WorkflowOption } from "./types";

const empty: ChannelsSnapshot = { version: 1, revision: 0, channels: [], credentials: [], providers: [] };

export default function ChannelsApp(_: AppProps) {
  const [snapshot, setSnapshot] = useState<ChannelsSnapshot>(empty);
  const [workflows, setWorkflows] = useState<WorkflowOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState<ChannelView | "new" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [channels, graphs] = await Promise.all([loadChannels(), loadChannelWorkflows()]);
      setSnapshot(channels);
      setWorkflows(graphs);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load Channels.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => void load());
    window.addEventListener("focus", load);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("focus", load); };
  }, [load]);

  const workflowNames = useMemo(() => new Map(workflows.map((row) => [row.id, row.name])), [workflows]);
  const toolbar = <div className="flex h-11 min-w-0 items-center gap-2 px-3">
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2"><span className="text-sm font-semibold">Channels</span><Badge variant="outline">{snapshot.channels.length}</Badge></div>
    </div>
    <Button size="icon" variant="ghost" aria-label="Refresh channels" onClick={() => void load()}><RefreshCw className="size-4"/></Button>
    <Button size="sm" variant="outline" onClick={() => openWindow("integrations", "Integrations")}><Plug className="mr-2 size-3"/>Integrations</Button>
    <Button size="sm" onClick={() => setEditor("new")}><Plus className="mr-2 size-3"/>Add</Button>
  </div>;

  return <div data-slot="channels-feature" className="@container h-full min-h-0 min-w-0">
    <AppFrame safeArea={false} className="h-full min-w-0 bg-background" toolbar={toolbar} bodyClassName="overflow-hidden">
      <div className="h-full overflow-y-auto p-3 @min-[720px]:p-4">
        {error ? <div role="alert" className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div> : null}
        {snapshot.channels.length ? <div className="grid gap-3 @min-[840px]:grid-cols-2">
          {snapshot.channels.map((row) => <ChannelCard
            key={row.id}
            row={row}
            revision={snapshot.revision}
            workflowName={row.workflowId ? workflowNames.get(row.workflowId) : undefined}
            onEdit={() => setEditor(row)}
            onReload={load}
          />)}
        </div> : <Empty loading={loading} hasCredentials={snapshot.credentials.length > 0} onAdd={() => setEditor("new")}/>}
      </div>
    </AppFrame>
    <ChannelEditor
      key={editor === "new" ? `new:${snapshot.revision}` : editor?.id ?? "closed"}
      open={editor !== null}
      onOpenChange={(open) => { if (!open) setEditor(null); }}
      row={editor && editor !== "new" ? editor : null}
      snapshot={snapshot}
      workflows={workflows}
      onSaved={load}
    />
  </div>;
}

function Empty({ loading, hasCredentials, onAdd }: { loading: boolean; hasCredentials: boolean; onAdd: () => void }) {
  return <div className="grid min-h-[55vh] place-items-center">
    <div className="w-full max-w-xl rounded-xl border bg-card p-5">
      <div className="flex items-start gap-3"><div className="grid size-10 place-items-center rounded-lg border bg-muted/40"><MessageSquareMore className="size-5"/></div><div>
        <h2 className="text-base font-semibold">{loading ? "Loading channels…" : "Connect MSO to a conversation channel"}</h2>
        <p className="mt-1 text-sm text-muted-foreground">Telegram and Discord share one channel contract. Credentials stay in Integrations; verified inbound events can start native Workflows.</p>
      </div></div>
      {!loading ? <div className="mt-4 flex flex-wrap gap-2">
        {hasCredentials ? <Button onClick={onAdd}><Plus className="mr-2 size-3"/>Add channel</Button> : <Button onClick={() => openWindow("integrations", "Integrations")}><Plug className="mr-2 size-3"/>Set up bot connection</Button>}
        <Button variant="outline" onClick={() => openWindow("workflows", "Workflows")}><Workflow className="mr-2 size-3"/>Open Workflows</Button>
      </div> : null}
    </div>
  </div>;
}
