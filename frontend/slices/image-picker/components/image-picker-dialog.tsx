"use client";

/** ImagePickerDialog — the 4-tab image chooser (Gallery · Upload · Link ·
 *  Stock). Upload tab appears only when `onUpload` is wired; the Stock tab
 *  live-searches /api/v1/stock/search (keyless Openverse, or Unsplash when the
 *  server holds a key) and falls back to the curated set. Usually you don't
 *  render this directly — use ImagePickerButton, which owns the trigger +
 *  open state. */

import * as React from "react";
import { FormDrawer } from "@/features/appshell";
import { cn } from "@/lib/utils";
import type { ImageValue, ImageSourceProps } from "../types";
import { GalleryTab } from "./image-picker/gallery-tab";
import { UploadTab } from "./image-picker/upload-tab";
import { LinkTab } from "./image-picker/link-tab";
import { UnsplashTab } from "./image-picker/unsplash-tab";

type Tab = "gallery" | "upload" | "link" | "unsplash";

interface Props extends ImageSourceProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSelect: (c: ImageValue) => void;
  title?: string;
  /** Pre-fill + auto-run the stock search (opens on that tab). */
  defaultQuery?: string;
}

export function ImagePickerDialog({ open, onOpenChange, onSelect, onUpload, title = "Choose image", defaultQuery }: Props) {
  const [tab, setTab] = React.useState<Tab>(defaultQuery ? "unsplash" : "gallery");
  const tabs: { id: Tab; label: string }[] = [
    { id: "gallery", label: "Gallery" },
    ...(onUpload ? [{ id: "upload" as const, label: "Upload" }] : []),
    { id: "link", label: "Link" },
    { id: "unsplash", label: "Stock" },
  ];
  const handle = (c: ImageValue) => { onSelect(c); onOpenChange(false); };

  return (
    <FormDrawer open={open} onOpenChange={onOpenChange} size="lg">
      <FormDrawer.Header>
        <FormDrawer.Title className="text-sm">{title}</FormDrawer.Title>
      </FormDrawer.Header>
      <div
        role="tablist"
        aria-label="Image source"
        className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5"
      >
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`image-picker-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`image-picker-panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => setTab(t.id)}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition [@media(pointer:coarse)]:min-h-[44px]",
                tab === t.id ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div
          role="tabpanel"
          id={`image-picker-panel-${tab}`}
          aria-labelledby={`image-picker-tab-${tab}`}
          className="flex-1 overflow-y-auto"
        >
          {tab === "gallery" && <GalleryTab onSelect={handle} />}
          {tab === "upload" && onUpload && <UploadTab onSelect={handle} onUpload={onUpload} />}
          {tab === "link" && <LinkTab onSelect={handle} />}
          {tab === "unsplash" && <UnsplashTab onSelect={handle} defaultQuery={defaultQuery} />}
        </div>
    </FormDrawer>
  );
}
