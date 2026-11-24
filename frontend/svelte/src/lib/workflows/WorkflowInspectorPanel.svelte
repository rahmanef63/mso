<script lang="ts">
  import { configFieldsForNode } from "./workflow-palette.ts";
  import WorkflowNodePalette from "./WorkflowNodePalette.svelte";
  import type { WorkflowEdge, WorkflowGraphDraft, WorkflowNode, WorkflowNodeType, WorkflowPaletteItem } from "./workflow-types.ts";
  import type { WorkflowGraphStatus } from "./workflows-api.ts";

  type SubTab = "inspector" | "palette" | "settings";
  type Props = {
    draft: WorkflowGraphDraft | null;
    selectedNode: WorkflowNode | null;
    selectedEdge: WorkflowEdge | null;
    onAddNode: (item: WorkflowPaletteItem) => void;
    onUpdateNode: (nodeId: string, patch: Partial<WorkflowNode>) => void;
    onDeleteNode: (nodeId: string) => void;
    onUpdateEdge: (edgeId: string, patch: Partial<WorkflowEdge>) => void;
    onDeleteEdge: (edgeId: string) => void;
    onUpdateDraftMeta: (patch: Partial<WorkflowGraphDraft>) => void;
  };

  let {
    draft, selectedNode, selectedEdge, onAddNode, onUpdateNode,
    onDeleteNode, onUpdateEdge, onDeleteEdge, onUpdateDraftMeta,
  }: Props = $props();

  let subTab = $state<SubTab>("inspector");
  let confirmDeleteNodeId = $state<string | null>(null);

  const editableNodeTypes: readonly { value: WorkflowNodeType; label: string }[] = [
    { value: "manual", label: "Manual Trigger" },
    { value: "webhook", label: "Webhook Trigger" },
    { value: "schedule", label: "Cron / Schedule" },
    { value: "integration", label: "HTTP Request" },
    { value: "tool", label: "Shell / Host Action" },
    { value: "agent", label: "AI Agent" },
    { value: "condition", label: "Condition / Branch" },
    { value: "merge", label: "Transform" },
    { value: "wait", label: "Delay" },
    { value: "channel_send", label: "Notify" },
    { value: "output", label: "Output" },
  ];

  let configFields = $derived(selectedNode ? configFieldsForNode(selectedNode.type) : []);
  let outgoingEdges = $derived(draft && selectedNode ? draft.edges.filter((e) => e.source === selectedNode.id) : []);

  function setNodeConfig(key: string, value: unknown) {
    if (!selectedNode) return;
    onUpdateNode(selectedNode.id, { config: { ...selectedNode.config, [key]: value } });
  }
  function updateTags(raw: string) {
    if (!draft) return;
    const tags = raw.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 32);
    onUpdateDraftMeta({ metadata: { ...draft.metadata, tags } });
  }
</script>

<aside class="wf-inspector" aria-label="Node palette and inspector">
  <div class="wf-subtabs" role="tablist" aria-label="Inspector sections">
    <button type="button" role="tab" class="wf-subtab" aria-selected={subTab === "inspector"} class:primary={subTab === "inspector"} onclick={() => { subTab = "inspector"; }}>Inspector</button>
    <button type="button" role="tab" class="wf-subtab" aria-selected={subTab === "palette"} class:primary={subTab === "palette"} onclick={() => { subTab = "palette"; }}>Add Nodes</button>
    <button type="button" role="tab" class="wf-subtab" aria-selected={subTab === "settings"} class:primary={subTab === "settings"} onclick={() => { subTab = "settings"; }}>Workflow</button>
  </div>

  {#if !draft}
    <p class="wf-note">Select or create a workflow to edit nodes and metadata.</p>
  {:else if subTab === "palette"}
    <WorkflowNodePalette {onAddNode} />
  {:else if subTab === "settings"}
    <div class="wf-pane-body">
      <div class="field">
        <label for="wf-meta-name">Workflow name</label>
        <input id="wf-meta-name" type="text" value={draft.name} oninput={(e) => onUpdateDraftMeta({ name: (e.currentTarget as HTMLInputElement).value })} />
      </div>
      <div class="field">
        <label for="wf-meta-desc">Description</label>
        <textarea id="wf-meta-desc" rows="3" value={draft.description} oninput={(e) => onUpdateDraftMeta({ description: (e.currentTarget as HTMLTextAreaElement).value })}></textarea>
      </div>
      <div class="field">
        <label for="wf-meta-status">Status</label>
        <select id="wf-meta-status" value={draft.status} onchange={(e) => onUpdateDraftMeta({ status: (e.currentTarget as HTMLSelectElement).value as WorkflowGraphStatus })}>
          <option value="draft">draft</option><option value="active">active</option><option value="archived">archived</option>
        </select>
      </div>
      <div class="field">
        <label for="wf-meta-tags">Tags (comma-separated)</label>
        <input id="wf-meta-tags" type="text" value={(draft.metadata.tags ?? []).join(", ")} placeholder="ops, webhook, nightly" oninput={(e) => updateTags((e.currentTarget as HTMLInputElement).value)} />
      </div>
      <div class="field">
        <label for="wf-meta-tz">Timezone</label>
        <input id="wf-meta-tz" type="text" value={draft.metadata.timezone ?? "UTC"} placeholder="UTC" oninput={(e) => onUpdateDraftMeta({ metadata: { ...draft.metadata, timezone: (e.currentTarget as HTMLInputElement).value } })} />
      </div>
    </div>
  {:else if selectedNode}
    <div class="wf-pane-body">
      <div class="wf-pane-head"><strong>Node: {selectedNode.name}</strong><span class="wf-badge">{selectedNode.type}</span></div>
      <div class="field">
        <label for="wf-node-label">Label</label>
        <input id="wf-node-label" type="text" value={selectedNode.name} oninput={(e) => onUpdateNode(selectedNode.id, { name: (e.currentTarget as HTMLInputElement).value })} />
      </div>
      <div class="field">
        <label for="wf-node-type">Node type</label>
        <select id="wf-node-type" value={selectedNode.type} onchange={(e) => onUpdateNode(selectedNode.id, { type: (e.currentTarget as HTMLSelectElement).value as WorkflowNodeType })}>
          {#each editableNodeTypes as opt (opt.value)}<option value={opt.value}>{opt.label}</option>{/each}
        </select>
      </div>
      <label class="wf-check">
        <input type="checkbox" checked={Boolean(selectedNode.disabled)} onchange={(e) => onUpdateNode(selectedNode.id, { disabled: (e.currentTarget as HTMLInputElement).checked })} />
        <span>Disable node in runs</span>
      </label>
      {#each configFields as field (field.key)}
        {#if field.kind === "checkbox"}
          <label class="wf-check">
            <input type="checkbox" checked={Boolean(selectedNode.config[field.key])} onchange={(e) => setNodeConfig(field.key, (e.currentTarget as HTMLInputElement).checked)} />
            <span>{field.label}</span>
          </label>
        {:else if field.kind === "select"}
          <div class="field">
            <label for={`wf-cfg-${field.key}`}>{field.label}</label>
            <select id={`wf-cfg-${field.key}`} value={String(selectedNode.config[field.key] ?? field.options?.[0] ?? "")} onchange={(e) => setNodeConfig(field.key, (e.currentTarget as HTMLSelectElement).value)}>
              {#each field.options ?? [] as opt}<option value={opt}>{opt}</option>{/each}
            </select>
          </div>
        {:else if field.kind === "textarea"}
          <div class="field">
            <label for={`wf-cfg-${field.key}`}>{field.label}</label>
            <textarea id={`wf-cfg-${field.key}`} rows="3" placeholder={field.placeholder} value={String(selectedNode.config[field.key] ?? "")} oninput={(e) => setNodeConfig(field.key, (e.currentTarget as HTMLTextAreaElement).value)}></textarea>
          </div>
        {:else if field.kind === "number"}
          <div class="field">
            <label for={`wf-cfg-${field.key}`}>{field.label}</label>
            <input id={`wf-cfg-${field.key}`} type="number" placeholder={field.placeholder} value={Number(selectedNode.config[field.key] ?? 0)} oninput={(e) => setNodeConfig(field.key, Number((e.currentTarget as HTMLInputElement).value))} />
          </div>
        {:else}
          <div class="field">
            <label for={`wf-cfg-${field.key}`}>{field.label}</label>
            <input id={`wf-cfg-${field.key}`} type="text" placeholder={field.placeholder} value={String(selectedNode.config[field.key] ?? "")} oninput={(e) => setNodeConfig(field.key, (e.currentTarget as HTMLInputElement).value)} />
          </div>
        {/if}
      {/each}
      {#if outgoingEdges.length > 0}
        <div class="wf-edges-box">
          <span class="wf-subhead">Outgoing edges ({outgoingEdges.length})</span>
          {#each outgoingEdges as edge (edge.id)}
            <div class="wf-edge-row">
              <span>{edge.target}{edge.sourceHandle ? ` (${edge.sourceHandle})` : ""}</span>
              <button type="button" class="wf-chip danger" onclick={() => onDeleteEdge(edge.id)}>Remove</button>
            </div>
          {/each}
        </div>
      {/if}
      <div class="wf-danger-row">
        {#if confirmDeleteNodeId === selectedNode.id}
          <button type="button" class="danger wf-chip" onclick={() => { confirmDeleteNodeId = null; onDeleteNode(selectedNode.id); }}>Confirm delete node</button>
          <button type="button" class="wf-chip" onclick={() => { confirmDeleteNodeId = null; }}>Cancel</button>
        {:else}
          <button type="button" class="danger wf-chip" onclick={() => { confirmDeleteNodeId = selectedNode.id; }}>Delete node</button>
        {/if}
      </div>
    </div>
  {:else if selectedEdge}
    <div class="wf-pane-body">
      <div class="wf-pane-head"><strong>Edge connection</strong><span class="wf-badge">{selectedEdge.id}</span></div>
      <p class="wf-note">{selectedEdge.source} -> {selectedEdge.target}</p>
      <div class="field">
        <label for="wf-edge-style">Line style</label>
        <select id="wf-edge-style" value={selectedEdge.style ?? "solid"} onchange={(e) => onUpdateEdge(selectedEdge.id, { style: (e.currentTarget as HTMLSelectElement).value as "solid" | "dashed" })}>
          <option value="solid">solid</option><option value="dashed">dashed</option>
        </select>
      </div>
      <label class="wf-check">
        <input type="checkbox" checked={Boolean(selectedEdge.disabled)} onchange={(e) => onUpdateEdge(selectedEdge.id, { disabled: (e.currentTarget as HTMLInputElement).checked })} />
        <span>Disable edge</span>
      </label>
      <button type="button" class="danger wf-chip" onclick={() => onDeleteEdge(selectedEdge.id)}>Delete edge</button>
    </div>
  {:else}
    <div class="wf-pane-body">
      <p class="wf-note">Click a node or edge on the canvas to inspect and edit its configuration, or add a new node from the palette.</p>
      <button type="button" class="primary wf-chip" onclick={() => { subTab = "palette"; }}>Open node palette</button>
      <button type="button" class="wf-chip" onclick={() => { subTab = "settings"; }}>Edit workflow metadata</button>
    </div>
  {/if}
</aside>

<style>
  .wf-inspector { display: grid; gap: 0.625rem; align-content: start; min-width: 0; border: 1px solid var(--border); border-radius: 0.625rem; padding: 0.625rem; background: var(--surface); }
  .wf-subtabs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.25rem; }
  .wf-subtab { min-height: 2rem; padding: 0.25rem 0.4rem; font-size: 0.78rem; }
  .wf-pane-body { display: grid; gap: 0.55rem; min-width: 0; max-height: 30rem; overflow-y: auto; }
  .wf-pane-body textarea { width: 100%; min-width: 0; padding: 0.45rem 0.6rem; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--panel-solid); color: var(--text); font: inherit; font-size: 0.82rem; resize: vertical; }
  .wf-pane-body input, .wf-pane-body select { min-height: 2.1rem; font-size: 0.82rem; width: 100%; min-width: 0; }
  .wf-pane-head { display: flex; align-items: center; justify-content: space-between; gap: 0.4rem; flex-wrap: wrap; }
  .wf-badge { padding: 0.1rem 0.45rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.7rem; color: var(--muted); }
  .wf-note { margin: 0; font-size: 0.8rem; color: var(--muted); }
  .wf-chip { min-height: 1.85rem; padding: 0.2rem 0.5rem; font-size: 0.75rem; }
  .wf-check { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.8rem; color: var(--text); }
  .wf-check input { width: auto; min-height: auto; }
  .wf-edges-box { display: grid; gap: 0.35rem; padding-top: 0.35rem; border-top: 1px solid var(--border); }
  .wf-subhead { font-size: 0.76rem; font-weight: 600; color: var(--muted); }
  .wf-edge-row { display: flex; align-items: center; justify-content: space-between; gap: 0.4rem; font-size: 0.78rem; }
  .wf-danger-row { display: flex; gap: 0.35rem; flex-wrap: wrap; padding-top: 0.4rem; border-top: 1px solid var(--border); }
</style>
