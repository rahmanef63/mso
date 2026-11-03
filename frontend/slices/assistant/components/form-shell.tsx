"use client";

import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

// Two-pane editor chrome: scrollable form on the left, sticky preview + save on
// the right. Reused by the Skill / Agent / Automation editors.
export function FormShell({
  title,
  editing,
  preview,
  children,
  onClose,
  onSave,
}: {
  title: string;
  editing: boolean;
  preview: ReactNode;
  children: ReactNode;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <div className="flex h-full w-full bg-background">
      <ScrollArea className="min-w-0 flex-1">
        <div className="p-6 [padding-bottom:calc(1.5rem+var(--sai-bottom))]">
          <div className="mb-4 flex items-center gap-2">
            <h2 className="min-w-0 truncate text-lg font-bold tracking-tight">{title}</h2>
            <Button variant="ghost" size="sm" className="ml-auto" onClick={onClose}>
              Cancel
            </Button>
            {/* The preview pane (with the save CTA) hides on compact panes —
                surface save in the header there so the form stays submittable. */}
            <Button size="sm" className="hidden @max-[700px]:inline-flex" onClick={onSave}>
              {editing ? "Save" : "Create"}
            </Button>
          </div>
          {children}
        </div>
      </ScrollArea>
      <div className="glass flex w-56 flex-none flex-col border-l border-border bg-card/40 p-5 @max-[700px]:hidden">
        <div className="mb-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Preview
        </div>
        {preview}
        <Button className="mt-auto" onClick={onSave}>
          {editing ? "Save changes" : "Create"}
        </Button>
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  const id = useId();
  const hintId = useId();
  const isControl = ["Name", "Persona", "Instructions", "Starter prompts", "Run as agent"].includes(label) && isValidElement(children);
  if (!isControl) return <fieldset className="mb-4 max-w-xl"><legend className="text-[13px] font-semibold">{label}</legend>{hint ? <p className="mb-1.5 mt-0.5 text-[11px] text-muted-foreground">{hint}</p> : null}{children}</fieldset>;
  return <div className="mb-4 max-w-xl">
    <label htmlFor={id} className="block text-[13px] font-semibold">{label}</label>
    {hint ? <p id={hintId} className="mb-1.5 mt-0.5 text-[11px] text-muted-foreground">{hint}</p> : <div className="mb-1.5" />}
    {cloneElement(children as ReactElement<{ id?: string; "aria-describedby"?: string }>, { id, "aria-describedby": hint ? hintId : undefined })}
  </div>;
}
