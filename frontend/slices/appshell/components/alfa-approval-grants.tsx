"use client";
import { Button } from "@/components/ui/button";
import { resetAlfaApprovalPolicy, revokeAlfaApproval, useAlfaApprovalGrants } from "../lib/alfa-approval-policy";

export function AlfaApprovalGrants() {
  const grants = useAlfaApprovalGrants();
  if (!grants.length) return null;
  return <details className="border-b border-border px-3 py-2 text-xs">
    <summary className="cursor-pointer py-1 [@media(pointer:coarse)]:min-h-11">Always approve: {grants.length} exact calls</summary>
    <p className="py-1 text-muted-foreground">Applies to identical arguments in the displayed conversation, project and mode. Cleared on a new or loaded chat.</p>
    {grants.map((grant) => <div key={grant.key} className="flex items-center gap-2 py-1">
      <span className="min-w-0 flex-1 break-words">{grant.tool} · {grant.scope}</span>
      <Button size="sm" variant="outline" onClick={() => revokeAlfaApproval(grant.key)} className="[@media(pointer:coarse)]:min-h-11">Revoke</Button>
    </div>)}
    <Button size="sm" variant="secondary" onClick={resetAlfaApprovalPolicy} className="[@media(pointer:coarse)]:min-h-11">Reset all approvals</Button>
  </details>;
}
