import type { ChannelProviderCapability, ChannelProviderId } from "./types";
import { ChannelError } from "./errors";

const providers: Record<ChannelProviderId, ChannelProviderCapability> = {
  telegram: {
    id: "telegram",
    title: "Telegram",
    inbound: "webhook",
    sendText: true,
    inboundEvents: true,
    notes: "Bot API send + verified webhook updates.",
  },
  discord: {
    id: "discord",
    title: "Discord",
    inbound: "interactions",
    sendText: true,
    inboundEvents: true,
    notes: "REST send + signed Interactions endpoint. Gateway message ingestion is not enabled.",
  },
};

export const listChannelProviders = () => Object.values(providers).map((value) => ({ ...value }));
export function channelProvider(id: ChannelProviderId) {
  const provider = providers[id];
  if (!provider) throw new ChannelError("unknown_channel_provider", 404);
  return provider;
}
