"use client";

import { useState } from "react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast, FormDrawer } from "@/features/appshell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { parseModelList } from "./custom-provider-config";
import { type ConnectedProvider } from "./provider-list";

/** Add, remove and discover the model ids a custom provider offers, without
 * leaving Settings and without re-pasting the key. Saves through the same
 * POST /api/config customProvider path as the add form, with select:false so
 * curating the list never silently switches the active model. */
export function ProviderModelsDialog({
  provider,
  open,
  onOpenChange,
  onSaved,
}: {
  provider: ConnectedProvider | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  if (!provider) return null;
  // Keyed on the provider: switching rows mounts a fresh editor seeded from that
  // provider's saved list. Seeding via an effect would be a cascading render.
  return (
    <ModelEditor
      key={provider.id}
      provider={provider}
      open={open}
      onOpenChange={onOpenChange}
      onSaved={onSaved}
    />
  );
}

function ModelEditor({
  provider,
  open,
  onOpenChange,
  onSaved,
}: {
  provider: ConnectedProvider;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [ids, setIds] = useState<string[]>(provider.models ?? []);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);

  const save = async (nextIds: string[]) => {
    setBusy(true);
    try {
      const response = await fetch("/api/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customProvider: {
            name: provider.id,
            protocol: provider.protocol === "anthropic" ? "anthropic" : "openai",
            models: nextIds,
          },
          select: false,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) return void toast(body.error || "Couldn’t save models", { tone: "error" });
      setIds(nextIds);
      toast(nextIds.length ? `Saved ${nextIds.length} model${nextIds.length === 1 ? "" : "s"}` : "Model list cleared");
      onSaved();
    } catch {
      toast("Couldn’t reach the server", { tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const add = () => {
    const incoming = parseModelList(draft).filter((id) => !ids.includes(id));
    if (!incoming.length) return void setDraft("");
    setDraft("");
    void save([...ids, ...incoming]);
  };

  // Discovery reads the key from the server-side store, so no credential travels.
  const discover = async () => {
    setScanning(true);
    try {
      const response = await fetch("/api/models/discover", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: provider.id }),
      });
      const body = (await response.json().catch(() => ({}))) as { ok?: boolean; models?: { id: string }[]; error?: string };
      if (!response.ok || body.ok === false) return void toast(body.error || "Discovery failed", { tone: "error" });
      const found = (body.models ?? []).map((model) => model.id);
      const merged = [...ids, ...found.filter((id) => !ids.includes(id))];
      if (merged.length === ids.length) return void toast("Endpoint offered no new model ids");
      await save(merged);
    } catch {
      toast("Couldn’t reach the server", { tone: "error" });
    } finally {
      setScanning(false);
    }
  };

  return (
    <FormDrawer open={open} onOpenChange={onOpenChange} size="md">
      <FormDrawer.Header>
        <FormDrawer.Title>Models: {provider.id}</FormDrawer.Title>
      </FormDrawer.Header>
      <FormDrawer.Body className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Model ids this endpoint serves. They appear in the Model picker above exactly as written here.
          Saving does not change the active model.
        </p>

        <div className="flex items-center gap-2">
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
            placeholder="model id, or several separated by commas"
            aria-label="Add model ids"
            className="font-mono text-xs"
            disabled={busy}
          />
          <Button size="sm" onClick={add} disabled={busy || !draft.trim()}>
            <Plus className="size-3.5" />
            Add
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => void discover()} disabled={busy || scanning}>
            <RefreshCw className={`size-3.5 ${scanning ? "animate-spin" : ""}`} />
            {scanning ? "Discovering…" : "Discover from endpoint"}
          </Button>
          <span className="text-xs text-muted-foreground">{ids.length} model{ids.length === 1 ? "" : "s"}</span>
        </div>

        {ids.length === 0 ? (
          <p className="rounded-md border border-border px-3 py-6 text-center text-sm text-muted-foreground">
            No models yet. Add an id above, or Discover to ask the endpoint what it serves.
          </p>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border">
            {ids.map((id) => (
              <div key={id} className="flex items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{id}</span>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Remove ${id}`}
                  disabled={busy}
                  onClick={() => void save(ids.filter((entry) => entry !== id))}
                  className="size-7 text-muted-foreground hover:text-destructive [@media(pointer:coarse)]:size-[44px]"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </FormDrawer.Body>
    </FormDrawer>
  );
}
