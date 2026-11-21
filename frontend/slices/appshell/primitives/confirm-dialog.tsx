"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "./responsive-dialog";

export type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
};

/**
 * Accessible, theme-aware confirmation dialog built on ResponsiveDialog.
 * Replaces blocking browser window.confirm() calls across feature slices.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  busy = false,
  onConfirm,
}: ConfirmDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const disabled = busy || submitting;

  const handleConfirm = async () => {
    if (disabled) return;
    setSubmitting(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ResponsiveDialog
      open={open}
      variant="alert"
      size="sm"
      dismissible={!disabled}
      onOpenChange={(next) => {
        if (!disabled) onOpenChange(next);
      }}
    >
      <ResponsiveDialog.Header>
        <ResponsiveDialog.Title>{title}</ResponsiveDialog.Title>
        <ResponsiveDialog.Description>{description}</ResponsiveDialog.Description>
      </ResponsiveDialog.Header>
      <ResponsiveDialog.Footer>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onOpenChange(false)}
        >
          {cancelLabel}
        </Button>
        <Button
          type="button"
          variant={destructive ? "destructive" : "default"}
          size="sm"
          disabled={disabled}
          onClick={() => void handleConfirm()}
        >
          {submitting ? "Working..." : confirmLabel}
        </Button>
      </ResponsiveDialog.Footer>
    </ResponsiveDialog>
  );
}
