import type { ChannelProviderId } from "./channels-api.ts";

export type ChannelDraftState = {
  name: string; provider: ChannelProviderId; credential: string;
  defaultTarget: string; workflowId: string; agentGroupId: string; enabled: boolean;
};

export const emptyChannelDraft: ChannelDraftState = {
  name: "", provider: "telegram", credential: "", defaultTarget: "",
  workflowId: "", agentGroupId: "", enabled: true,
};

export type ChannelHealth = "disabled" | "error" | "needs-setup" | "connected" | "configured";

const CREDENTIAL_SEPARATOR = "::";

export function credentialValue(user: string, connection: string): string {
  return `${user}${CREDENTIAL_SEPARATOR}${connection}`;
}

export function splitCredential(value: string): { user: string; connection: string } | null {
  const index = value.indexOf(CREDENTIAL_SEPARATOR);
  if (index <= 0) return null;
  const user = value.slice(0, index).trim();
  const connection = value.slice(index + CREDENTIAL_SEPARATOR.length).trim();
  return user && connection ? { user, connection } : null;
}

/** One status vocabulary shared by the card badge and the filter, so a row cannot read
 *  "Connected" on the card and "error" in the filter. */
export function channelHealth(input: {
  enabled: boolean; connectionState: string | null; connectionError: string | null;
  lastCheckOk: boolean | null;
}): ChannelHealth {
  if (!input.enabled) return "disabled";
  if (input.connectionError || input.connectionState === "missing" || input.connectionState === "invalid") return "error";
  if (input.lastCheckOk === false) return "error";
  if (input.lastCheckOk === true || input.connectionState === "verified") return "connected";
  if (input.connectionState === "incomplete" || !input.connectionState) return "needs-setup";
  return "configured";
}

const HEALTH_LABEL: Record<ChannelHealth, string> = {
  disabled: "Disabled", error: "Error", "needs-setup": "Needs setup", connected: "Connected", configured: "Configured",
};

export const healthLabel = (health: ChannelHealth): string => HEALTH_LABEL[health];

export function healthTone(health: ChannelHealth): "ok" | "warn" | "danger" | "neutral" {
  if (health === "connected") return "ok";
  if (health === "needs-setup" || health === "configured") return "warn";
  if (health === "error") return "danger";
  return "neutral";
}

export function draftDirty(draft: ChannelDraftState, initial: ChannelDraftState): boolean {
  return draft.name !== initial.name || draft.provider !== initial.provider || draft.credential !== initial.credential
    || draft.defaultTarget !== initial.defaultTarget || draft.workflowId !== initial.workflowId
    || draft.agentGroupId !== initial.agentGroupId || draft.enabled !== initial.enabled;
}

export function draftValid(draft: ChannelDraftState): boolean {
  return draft.name.trim().length > 0 && splitCredential(draft.credential) !== null;
}

export function inboundPath(provider: ChannelProviderId, id: string): string {
  return `/api/v1/channels/${provider}/${id}`;
}

export function targetHint(provider: ChannelProviderId): { label: string; placeholder: string } {
  return provider === "telegram"
    ? { label: "Default chat ID or @channel", placeholder: "-1001234567890" }
    : { label: "Default channel ID", placeholder: "123456789012345678" };
}
