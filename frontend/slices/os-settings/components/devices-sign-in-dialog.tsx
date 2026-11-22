"use client";

import { ResponsiveDialog } from "@/features/appshell";
import { LoginCard } from "@/features/auth/panels";

/** Sign-in prompt used by the Devices host card when a live/SSH target is selected
 *  while signed out. Split out of devices-host-card.tsx for the 220-line cap. */
export function DevicesSignInDialog({
  open,
  onOpenChange,
  onAuthed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAuthed: () => void | Promise<void>;
}) {
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} size="sm">
      <ResponsiveDialog.Header>
        <ResponsiveDialog.Title>Sign in</ResponsiveDialog.Title>
      </ResponsiveDialog.Header>
      <ResponsiveDialog.Body>
        <LoginCard onAuthed={onAuthed} />
      </ResponsiveDialog.Body>
    </ResponsiveDialog>
  );
}
