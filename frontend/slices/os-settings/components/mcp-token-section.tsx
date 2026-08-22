"use client";

import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsActionRow, SettingsBlock, SettingsSection } from "@/features/shell-settings";

export type McpTokenRow = {
  id: string;
  label: string;
  clientId: string;
  scope: string;
  createdAt: number;
  expiresAt: number;
  lastUsedAt?: number;
  status: "active" | "revoked" | "expired";
};

const formatTime = (time?: number) => (time ? new Date(time).toLocaleString() : "Never");

export function McpTokenSection({
  tokens,
  onRevoke,
}: {
  tokens: McpTokenRow[];
  onRevoke: (id: string, what: string) => Promise<void>;
}) {
  const live = tokens.filter((token) => token.status === "active");
  return (
    <SettingsSection
      icon={<KeyRound />}
      title={`Access tokens (${tokens.length})`}
      footnote="Tokens are stored as hashes; the raw value is shown once when minted. Revocation is checked on every MCP call."
    >
      {tokens.length === 0 ? (
        <SettingsBlock className="py-4">
          <p className="text-xs leading-relaxed text-muted-foreground">No tokens yet. One is minted after you approve a client on the OAuth consent screen.</p>
        </SettingsBlock>
      ) : (
        tokens.map((token) => {
          const inactive = token.status !== "active";
          return (
            <SettingsBlock key={token.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={inactive ? "text-sm font-medium text-muted-foreground line-through" : "text-sm font-medium"}>{token.label}</span>
                  <span className="rounded-md bg-secondary px-2 py-0.5 font-mono text-[10px]">{token.scope}</span>
                  {inactive && <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{token.status}</span>}
                </div>
                <p className="break-all font-mono text-[10px] leading-relaxed text-muted-foreground">{token.clientId}</p>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Last used {formatTime(token.lastUsedAt)} · expires {formatTime(token.expiresAt)}
                </p>
              </div>
              {!inactive && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="min-h-9 shrink-0 self-end text-destructive sm:self-auto [@media(pointer:coarse)]:min-h-[44px]"
                  onClick={() => void onRevoke(token.id, token.label)}
                >
                  Revoke
                </Button>
              )}
            </SettingsBlock>
          );
        })
      )}
      {live.length > 0 && (
        <SettingsActionRow
          label={`Revoke all (${live.length})`}
          tone="destructive"
          onClick={() => void onRevoke("all", `all ${live.length} live token(s)`)}
        />
      )}
    </SettingsSection>
  );
}
