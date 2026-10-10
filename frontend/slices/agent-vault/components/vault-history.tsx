import type { AgentVaultState } from "@/lib/contracts/agent-vault";

export function VaultHistory({ state, selected, onSelect }: { state: AgentVaultState; selected: string; onSelect: (id: string) => void }) {
  const snapshots = [...state.snapshots].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  return <div className="p-3">
    <p className="mb-3 text-xs text-muted-foreground">Recorded changes from repository captures. Refresh to capture new evidence.</p>
    <ol className="space-y-2">{snapshots.map(snapshot => <li key={snapshot.id}>
      <button type="button" aria-pressed={snapshot.id === selected} onClick={() => onSelect(snapshot.id)} className={`w-full rounded-lg border p-3 text-left hover:bg-muted ${snapshot.id === selected ? "bg-muted" : ""}`}>
        <time dateTime={snapshot.capturedAt} className="block text-sm font-medium">{new Date(snapshot.capturedAt).toLocaleString()}</time>
        <span className="text-xs text-muted-foreground">{snapshot.notes.length} notes{snapshot.id === state.current ? " · latest" : ""}{snapshot.truncated ? " · partial" : ""}</span>
      </button>
    </li>)}</ol>
  </div>;
}
