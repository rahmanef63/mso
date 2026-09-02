"use client";

import { Button } from "@/components/ui/button";
import { SettingsBlock } from "@/features/shell-settings";
import {
  shortA2AId,
  type A2AAction,
  type A2AAgentRow,
  type A2ACredentialRow,
} from "./a2a-section-model";

export function A2APeerProfileList({
  agent,
  profiles,
  busy,
  act,
}: {
  agent: A2AAgentRow;
  profiles: A2ACredentialRow[];
  busy: boolean;
  act: A2AAction;
}) {
  const active = profiles.find(
    (credential) => credential.id === agent.credentialProfileId,
  );
  return (
    <SettingsBlock className="space-y-3 py-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">
            {agent.alias}{" "}
            <span className="font-normal text-muted-foreground">
              · {agent.card.name}
            </span>
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {agent.card.requiresAuthentication
              ? "Authentication required"
              : "Authentication optional"}{" "}
            · active: {active?.label ?? "none"}
          </p>
        </div>
        <code className="text-[10px] text-muted-foreground">
          {shortA2AId(agent.id)}
        </code>
      </div>
      {profiles.length > 0 && (
        <div className="flex snap-x gap-2 overflow-x-auto pb-1">
          {profiles.map((credential) => {
            const isActive = agent.credentialProfileId === credential.id;
            return (
              <div
                key={credential.id}
                className="min-w-[13rem] snap-start rounded-lg border p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-medium">
                    {credential.label}
                  </span>
                  <code className="text-[10px]">
                    {credential.kind}
                    {credential.schemeName ? ` · ${credential.schemeName}` : ""}
                  </code>
                </div>
                <div className="mt-3 flex gap-1">
                  <Button
                    size="sm"
                    variant={isActive ? "secondary" : "outline"}
                    disabled={busy || isActive}
                    onClick={() =>
                      void act(
                        {
                          action: "credential-use",
                          target: agent.id,
                          credentialId: credential.id,
                        },
                        `Activated ${credential.label}`,
                      )
                    }
                  >
                    {isActive ? "Active" : "Use"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    disabled={busy}
                    onClick={() =>
                      void act(
                        {
                          action: "credential-remove",
                          credentialId: credential.id,
                        },
                        `Removed ${credential.label}`,
                      )
                    }
                  >
                    Remove
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </SettingsBlock>
  );
}
