"use client";

import { Button } from "@/components/ui/button";
import { SettingsBlock } from "@/features/shell-settings";
import type { UpdateStatus } from "@/lib/host/self-update";
import { REFUSAL_COMMANDS, updateRefusalRemedy } from "./update-status-client";

/**
 * The refusal panel. Shown instead of the normal status card when the host says
 * it cannot update itself — a wrong branch, a dirty checkout, no service unit.
 *
 * This used to render the ordinary card with zero action rows, which reads as a
 * missing button. The reason is now the headline and, when a shell can fix it,
 * the exact commands are printed.
 */
export function UpdateStatusUnsupported({
  reason,
  info,
  onRetry,
}: {
  reason: string;
  info: UpdateStatus;
  onRetry: () => void;
}) {
  // The remedy is decided by the reason, not by a generic "try again". Only two
  // refusals are actionable from a shell, so only those print commands.
  const remedy = updateRefusalRemedy(reason);
  return (
    <SettingsBlock className="space-y-3 p-4">
      <p role="alert" className="text-sm font-medium text-destructive-text">
        Software updates are unavailable on this checkout
      </p>
      <p className="text-[11px] leading-relaxed text-muted-foreground">{reason}</p>
      <p className="font-mono text-[11px] text-muted-foreground">
        Running {info.buildSha || "unknown"} · Checkout {info.current || "unknown"}
      </p>
      {remedy && (
        <div className="space-y-1.5 rounded-md border border-border/60 bg-secondary/40 p-2.5">
          <p className="text-[11px] font-medium text-foreground">Fix on the host, then reload this page:</p>
          <pre className="overflow-x-auto font-mono text-[11px] leading-relaxed text-muted-foreground">{REFUSAL_COMMANDS[remedy]}</pre>
        </div>
      )}
      <Button type="button" variant="outline" onClick={onRetry}>Check again</Button>
    </SettingsBlock>
  );
}
