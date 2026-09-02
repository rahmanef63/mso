"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettingsBlock, SettingsSection } from "@/features/shell-settings";
import {
  type A2AAction,
  type A2ACredentialRow,
  type A2ASettingsState,
} from "./a2a-section-model";
import { A2APeerProfileList } from "./a2a-peer-profile-list";

export function A2APeerSettings({
  state,
  busy,
  act,
}: {
  state: A2ASettingsState;
  busy: boolean;
  act: A2AAction;
}) {
  const [peerId, setPeerId] = useState(state.agents[0]?.id ?? "");
  const [label, setLabel] = useState("default");
  const [kind, setKind] = useState<A2ACredentialRow["kind"]>("bearer");
  const [secret, setSecret] = useState("");
  const [headerName, setHeaderName] = useState("X-API-Key");
  const [schemeName, setSchemeName] = useState("");
  const selectedPeerId = state.agents.some((agent) => agent.id === peerId)
    ? peerId
    : (state.agents[0]?.id ?? "");
  const selectedAgent = state.agents.find(
    (agent) => agent.id === selectedPeerId,
  );
  const schemes = selectedAgent?.card.securitySchemeNames ?? [];
  const selectedScheme = schemes.includes(schemeName)
    ? schemeName
    : (schemes[0] ?? "");
  const scheme = selectedScheme
    ? selectedAgent?.card.securitySchemes?.[selectedScheme]
    : undefined;
  const schemeKind: A2ACredentialRow["kind"] | null =
    scheme?.kind === "api-key"
      ? "api-key"
      : scheme?.kind === "http" && scheme.scheme.toLowerCase() === "bearer"
        ? "bearer"
        : scheme?.kind === "oauth2" || scheme?.kind === "openid"
          ? "oauth2"
          : null;
  const effectiveKind = schemeKind ?? kind;
  const effectiveHeader =
    scheme?.kind === "api-key" && scheme.location === "header"
      ? scheme.name
      : headerName;
  const unsupportedScheme =
    scheme?.kind === "api-key" && scheme.location !== "header"
      ? `MSO 1.8 supports header API keys only; this Agent Card requires ${scheme.location}.`
      : scheme?.kind === "http" && scheme.scheme.toLowerCase() !== "bearer"
        ? `HTTP auth scheme ${scheme.scheme} is not supported.`
        : scheme?.kind === "mtls"
          ? "mTLS peer credentials are not supported in MSO 1.8."
          : scheme?.kind === "unknown"
            ? "This Agent Card uses an unsupported or invalid security scheme."
            : "";

  async function createCredential() {
    const data = await act(
      {
        action: "credential-create",
        agentId: selectedPeerId,
        label,
        kind: effectiveKind,
        secret,
        ...(effectiveKind === "api-key" ? { headerName: effectiveHeader } : {}),
        ...(selectedScheme ? { schemeName: selectedScheme } : {}),
        activate: true,
      },
      "Peer credential saved and activated",
    );
    if (data) setSecret("");
  }

  return (
    <SettingsSection
      icon={<KeyRound />}
      title={`Peer credentials (${state.credentials.length})`}
      footnote="Secrets live only in ~/.mso/private/a2a-credentials.json (0600). OAuth2 profiles currently accept an externally acquired access token; browser OAuth exchange is intentionally not implicit."
    >
      {state.agents.length === 0 ? (
        <SettingsBlock className="py-4 text-xs text-muted-foreground">
          Register a peer first with{" "}
          <code className="font-mono">mso a2a add &lt;url&gt;</code>.
        </SettingsBlock>
      ) : (
        <SettingsBlock className="space-y-3 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="a2a-peer">Peer</Label>
              <select
                id="a2a-peer"
                value={selectedPeerId}
                onChange={(event) => setPeerId(event.target.value)}
                className="h-9 w-full rounded-md border bg-background px-3 text-sm [@media(pointer:coarse)]:min-h-[44px]"
              >
                {state.agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.alias} — {agent.card.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="a2a-cred-label">Profile label</Label>
              <Input
                id="a2a-cred-label"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="a2a-kind">Auth type</Label>
              <select
                id="a2a-kind"
                value={effectiveKind}
                disabled={Boolean(schemeKind)}
                onChange={(event) => setKind(event.target.value as typeof kind)}
                className="h-9 w-full rounded-md border bg-background px-3 text-sm [@media(pointer:coarse)]:min-h-[44px]"
              >
                <option value="bearer">Bearer</option>
                <option value="api-key">API key</option>
                <option value="oauth2">OAuth2 access token</option>
              </select>
            </div>
            {effectiveKind === "api-key" && (
              <div className="space-y-1.5">
                <Label htmlFor="a2a-header">Header</Label>
                <Input
                  id="a2a-header"
                  value={effectiveHeader}
                  disabled={
                    scheme?.kind === "api-key" && scheme.location === "header"
                  }
                  onChange={(event) => setHeaderName(event.target.value)}
                />
              </div>
            )}
            {schemes.length > 1 && (
              <div className="space-y-1.5">
                <Label htmlFor="a2a-scheme">Agent Card scheme</Label>
                <select
                  id="a2a-scheme"
                  value={selectedScheme}
                  onChange={(event) => setSchemeName(event.target.value)}
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm [@media(pointer:coarse)]:min-h-[44px]"
                >
                  {schemes.map((scheme) => (
                    <option key={scheme} value={scheme}>
                      {scheme}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          {unsupportedScheme && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {unsupportedScheme}
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="a2a-secret">Secret</Label>
            <Input
              id="a2a-secret"
              type="password"
              autoComplete="off"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              placeholder={
                kind === "oauth2" ? "Access token" : "Credential secret"
              }
            />
          </div>
          <Button
            disabled={
              busy ||
              !selectedPeerId ||
              !label.trim() ||
              !secret ||
              Boolean(unsupportedScheme)
            }
            className="[@media(pointer:coarse)]:min-h-[44px]"
            onClick={() => void createCredential()}
          >
            Save & activate
          </Button>
        </SettingsBlock>
      )}
      {state.agents.map((agent) => (
        <A2APeerProfileList
          key={agent.id}
          agent={agent}
          profiles={state.credentials.filter(
            (credential) => credential.agentId === agent.id,
          )}
          busy={busy}
          act={act}
        />
      ))}
    </SettingsSection>
  );
}
