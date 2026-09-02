"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { FormDrawer } from "@/features/appshell";

// One confirm for update / restore / uninstall, so the three destructive flows
// read identically and none of them can ship a bare `window.confirm`. Dialog on
// desktop, bottom drawer on a phone — that is what FormDrawer does.
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  intro,
  confirmLabel,
  destructive,
  disabled,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  intro: string;
  confirmLabel: string;
  destructive?: boolean;
  /** Gate for the "type the app id" style confirmation. */
  disabled?: boolean;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  return (
    <FormDrawer open={open} onOpenChange={onOpenChange} variant="alert" size="md">
      <FormDrawer.Header>
        <FormDrawer.Title>{title}</FormDrawer.Title>
        <FormDrawer.Description>{intro}</FormDrawer.Description>
      </FormDrawer.Header>
      <FormDrawer.Body className="space-y-3 text-xs leading-relaxed text-muted-foreground">
        {children}
      </FormDrawer.Body>
      <FormDrawer.Footer className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          variant={destructive ? "destructive" : "default"}
          disabled={disabled}
          onClick={() => {
            onOpenChange(false);
            onConfirm();
          }}
        >
          {confirmLabel}
        </Button>
      </FormDrawer.Footer>
    </FormDrawer>
  );
}
