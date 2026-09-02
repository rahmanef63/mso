"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Globe, Link2, Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FormDrawer } from "@/features/appshell";
import { useQuicklinks, faviconUrl, normalizeUrl } from "@/lib/quicklinks";
import { SettingsSection, SettingsBlock } from "@/features/shell-settings";

type PendingQL = { id: string; label: string };

// Manage website shortcuts. They surface (with their favicon) in the dock,
// Launchpad, mobile grid, the Today widget and the Quicklinks window; opening
// one pops a new native browser tab.
export function QuicklinksSection() {
  const { items, add, update, remove, move } = useQuicklinks();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  // Destructive confirm — losing a quicklink mid-typing is the kind of miss
  // tap that triggers a sigh, so we gate the Trash button behind a dialog.
  const [pending, setPending] = useState<PendingQL | null>(null);

  const submit = () => {
    if (!url.trim()) return;
    add(url, title);
    setUrl("");
    setTitle("");
  };

  return (
    <>
      <SettingsSection
        icon={<Link2 />}
        title={`Shortcuts (${items.length})`}
        footnote="Shortcuts surface with their favicon in the dock, Launchpad, mobile grid and Spotlight; opening one pops a new browser tab."
      >
        {items.length === 0 && (
          <SettingsBlock>
            <p className="text-xs text-muted-foreground">No quicklinks yet — add one below.</p>
          </SettingsBlock>
        )}
        {items.map((ql, i) => {
          const src = faviconUrl(ql.url);
          return (
            <SettingsBlock key={ql.id} className="flex flex-wrap items-center gap-2 @md:flex-nowrap">
              <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-md bg-white text-zinc-500">
                {src ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={src} alt="" width={18} height={18} loading="lazy" decoding="async" className="size-[18px] object-contain" />
                ) : (
                  <Globe className="size-4" />
                )}
              </span>
              <Input
                value={ql.title}
                onChange={(e) => update(ql.id, { title: e.target.value })}
                aria-label="Label"
                className="h-8 min-w-[100px] flex-1"
              />
              <Input
                value={ql.url}
                onChange={(e) => update(ql.id, { url: e.target.value })}
                onBlur={(e) => update(ql.id, { url: normalizeUrl(e.target.value) })}
                aria-label="URL"
                className="order-last h-8 min-w-0 basis-full font-mono text-[11px] @md:order-none @md:basis-0 @md:flex-[2]"
              />
              <Button type="button" variant="ghost" size="icon" aria-label="Move up" onClick={() => move(ql.id, -1)} disabled={i === 0} className="[@media(pointer:coarse)]:size-[44px]">
                <ArrowUp className="size-4" />
              </Button>
              <Button type="button" variant="ghost" size="icon" aria-label="Move down" onClick={() => move(ql.id, 1)} disabled={i === items.length - 1} className="[@media(pointer:coarse)]:size-[44px]">
                <ArrowDown className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Remove"
                className="[@media(pointer:coarse)]:size-[44px]"
                onClick={() => setPending({ id: ql.id, label: ql.title || ql.url })}
              >
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </SettingsBlock>
          );
        })}
        {/* Add row — flush-free, iOS "+ new item at the list bottom" */}
        <SettingsBlock className="flex flex-col gap-2 @md:flex-row">
          <Input
            placeholder="github.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            aria-label="Website URL"
          />
          <Input
            placeholder="Label (optional)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            aria-label="Label"
            className="@md:max-w-[38%]"
          />
          <Button type="button" onClick={submit} className="shrink-0">
            <Plus className="size-4" /> Add
          </Button>
        </SettingsBlock>
      </SettingsSection>

      <FormDrawer open={pending !== null} onOpenChange={(open) => !open && setPending(null)} size="sm">
        <FormDrawer.Header>
          <FormDrawer.Title>Remove quick link?</FormDrawer.Title>
          <FormDrawer.Description>
            {pending ? `"${pending.label}" will be removed from your dock and Spotlight.` : ""}
          </FormDrawer.Description>
        </FormDrawer.Header>
        <FormDrawer.Footer>
          <Button type="button" variant="ghost" onClick={() => setPending(null)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              if (pending) remove(pending.id);
              setPending(null);
            }}
          >
            <Trash2 className="size-4" />
            Remove
          </Button>
        </FormDrawer.Footer>
      </FormDrawer>
    </>
  );
}
