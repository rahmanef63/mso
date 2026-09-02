"use client";

import { useState } from "react";
import { Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettingsBlock, SettingsSection } from "@/features/shell-settings";
import { McpCopyField } from "./mcp-copy-field";
import {
  shortA2AId,
  type A2AAction,
  type A2ASettingsState,
} from "./a2a-section-model";

export function A2AInboundSettings({
  state,
  busy,
  act,
}: {
  state: A2ASettingsState;
  busy: boolean;
  act: A2AAction;
}) {
  const [oneTimeToken, setOneTimeToken] = useState("");
  const [label, setLabel] = useState("peer");
  const [scope, setScope] = useState<"read" | "write" | "exec">("read");

  async function createToken() {
    const data = await act(
      { action: "inbound-token-create", label, scope },
      "Inbound A2A credential created",
    );
    if (typeof data?.token === "string") setOneTimeToken(data.token);
  }

  return (
    <SettingsSection
      icon={<Radio />}
      title="Inbound A2A server"
      footnote="Inbound A2A is disabled by default. A public HTTPS origin and an owner-minted bearer are both required before any task can run."
    >
      {!state.inbound.enabled ? (
        <SettingsBlock className="space-y-3 py-4">
          <div>
            <p className="text-sm font-medium">Inbound server is off</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Reason:{" "}
              <code className="font-mono">
                {state.inbound.reason ?? "disabled"}
              </code>
              . Configure both values, then rebuild/restart MSO.
            </p>
          </div>
          <McpCopyField
            label="Required config"
            value={
              "OS_A2A_INBOUND_ENABLED=1\nOS_PUBLIC_ORIGIN=https://mso.example.com"
            }
            multiline
          />
        </SettingsBlock>
      ) : (
        <>
          <SettingsBlock className="space-y-3 py-4">
            <div className="flex flex-wrap items-center gap-2">
              {["A2A v1", "JSON-RPC + SSE", "Bearer"].map((item) => (
                <span
                  key={item}
                  className="rounded-md bg-secondary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                >
                  {item}
                </span>
              ))}
            </div>
            {state.inbound.cardUrl && (
              <McpCopyField label="Agent Card" value={state.inbound.cardUrl} />
            )}
            {state.inbound.protocolUrl && (
              <McpCopyField
                label="Protocol endpoint"
                value={state.inbound.protocolUrl}
              />
            )}
          </SettingsBlock>
          <SettingsBlock className="space-y-3 py-4">
            <div>
              <p className="text-sm font-medium">Create inbound credential</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Scope is the maximum authority this remote agent receives. Start
                at read.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_9rem_auto] sm:items-end">
              <div className="space-y-1.5">
                <Label htmlFor="a2a-in-label">Label</Label>
                <Input
                  id="a2a-in-label"
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder="research-agent"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="a2a-in-scope">Scope</Label>
                <select
                  id="a2a-in-scope"
                  value={scope}
                  onChange={(event) =>
                    setScope(event.target.value as typeof scope)
                  }
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm [@media(pointer:coarse)]:min-h-[44px]"
                >
                  <option value="read">read</option>
                  <option value="write">write</option>
                  <option value="exec">exec</option>
                </select>
              </div>
              <Button
                disabled={busy || !label.trim()}
                className="[@media(pointer:coarse)]:min-h-[44px]"
                onClick={() => void createToken()}
              >
                Create
              </Button>
            </div>
            {oneTimeToken && (
              <div className="space-y-2 rounded-lg border border-dashed p-3">
                <p className="text-xs font-medium">
                  Copy this token now. MSO stores only its hash and cannot show
                  it again.
                </p>
                <McpCopyField label="One-time bearer" value={oneTimeToken} />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setOneTimeToken("")}
                >
                  I’ve saved it
                </Button>
              </div>
            )}
          </SettingsBlock>
        </>
      )}
      {state.inboundTokens.map((token) => (
        <SettingsBlock
          key={token.id}
          className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center"
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{token.label}</span>
              <code className="rounded bg-secondary px-1.5 py-0.5 text-[10px]">
                {token.scope}
              </code>
            </div>
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">
              {shortA2AId(token.id)} ·{" "}
              {new Date(token.createdAt).toLocaleString()}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            className="self-end text-destructive sm:self-auto [@media(pointer:coarse)]:min-h-[44px]"
            onClick={() =>
              void act(
                { action: "inbound-token-remove", tokenId: token.id },
                `Revoked ${token.label}`,
              )
            }
          >
            Revoke
          </Button>
        </SettingsBlock>
      ))}
    </SettingsSection>
  );
}
