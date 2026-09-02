"use client";

import { toast } from "@/features/appshell";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";

export type ConnectedProvider = {
  id: string;
  kind: "builtin" | "custom" | "oauth";
  hasKey: boolean;
  masked: string;
  baseUrl?: string;
  protocol?: string;
  models?: string[];
};

// The connected providers (built-in-with-key + custom) with remove. Deleting a
// provider forgets its key + custom wiring (DELETE /api/config?provider=slug);
// if it was selected, the server falls back to the default. onChanged refreshes.
export function ProviderList({
  providers,
  selected,
  onChanged,
}: {
  providers: ConnectedProvider[];
  selected: string;
  onChanged: () => void;
}) {
  async function remove(id: string) {
    const r = await fetch(`/api/config?provider=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!r.ok) {
      toast("Couldn’t remove provider", { tone: "error" });
      return;
    }
    onChanged();
  }

  if (!providers.length) return null;

  return (
    <div className="divide-y divide-border rounded-lg border border-border">
      {providers.map((p) => (
        <div key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm">
          <span className="font-medium">{p.id}</span>
          {p.kind === "custom" && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">custom</span>
          )}
          {p.kind === "oauth" && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">OAuth</span>
          )}
          {p.id === selected && (
            <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[11px] text-primary">active</span>
          )}
          <span className="ml-auto truncate text-xs text-muted-foreground">{p.baseUrl || p.masked}</span>
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Remove ${p.id}`}
            onClick={() => remove(p.id)}
            className="size-7 text-muted-foreground hover:text-destructive [@media(pointer:coarse)]:size-[44px]"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}
