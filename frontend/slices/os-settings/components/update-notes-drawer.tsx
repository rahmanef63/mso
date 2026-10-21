"use client";

import { Button } from "@/components/ui/button";
import { FormDrawer } from "@/features/appshell";
import type { UpdateCommit } from "@/lib/host/self-update";
import { UpdateNotes } from "./update-notes";

/** Release-notes drawer for the Updates section. Split out of update-section.tsx to
 *  keep that file inside the 220-line architecture cap. */
export function UpdateNotesDrawer({
  open,
  onOpenChange,
  behind,
  commits,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  behind: number;
  commits: UpdateCommit[];
}) {
  return (
    <FormDrawer open={open} onOpenChange={onOpenChange} size="lg">
      <FormDrawer.Header>
        <FormDrawer.Title>
          {behind > 0 ? `What's in this update (${behind})` : "Release notes"}
        </FormDrawer.Title>
        <FormDrawer.Description>
          Incoming commits first, then everything already shipped to this
          deployment.
        </FormDrawer.Description>
      </FormDrawer.Header>
      <UpdateNotes commits={commits} />
      <FormDrawer.Footer>
        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      </FormDrawer.Footer>
    </FormDrawer>
  );
}
