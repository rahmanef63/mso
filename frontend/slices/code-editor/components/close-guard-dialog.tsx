"use client";

import { Button } from "@/components/ui/button";
import { FormDrawer } from "@/features/os-shell";

// Unsaved-changes prompt shown when a dirty window is closed: Save (writes then
// closes) / Don't Save (discards + closes) / Cancel (keeps the window open).
// FormDrawer keeps the behavior shared while the active shell chooses the native
// presentation: content dialog on desktop, Apple/Material drawer on mobile.
export function CloseGuardDialog({
  open,
  onOpenChange,
  fileLabel,
  onSave,
  onDiscard,
  onCancel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileLabel: string;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  return (
    <FormDrawer open={open} onOpenChange={onOpenChange} variant="alert" size="sm">
      <FormDrawer.Header>
        <FormDrawer.Title>Save changes before closing?</FormDrawer.Title>
        <FormDrawer.Description>
          {fileLabel} has unsaved edits. They&apos;ll be lost if you don&apos;t save.
        </FormDrawer.Description>
      </FormDrawer.Header>
      <FormDrawer.Footer>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button variant="ghost" className="text-destructive" onClick={onDiscard}>Don&apos;t Save</Button>
        <Button onClick={onSave}>Save</Button>
      </FormDrawer.Footer>
    </FormDrawer>
  );
}
