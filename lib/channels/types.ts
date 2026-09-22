export const CHANNEL_PROVIDER_IDS = ["telegram", "discord"] as const;
export type ChannelProviderId = (typeof CHANNEL_PROVIDER_IDS)[number];

export type ChannelCredentialRef = {
  user: string;
  connection: string;
};

export type ChannelCheck = {
  at: string;
  ok: boolean;
  detail: string;
};

export type ChannelRecord = {
  id: string;
  name: string;
  provider: ChannelProviderId;
  credential: ChannelCredentialRef;
  enabled: boolean;
  defaultTarget?: string;
  workflowId?: string;
  createdAt: string;
  updatedAt: string;
  lastCheck?: ChannelCheck;
  lastActivityAt?: string;
};

export type ChannelState = {
  version: 1;
  revision: number;
  channels: ChannelRecord[];
};

export type ChannelInboundEvent = {
  provider: ChannelProviderId;
  eventId: string;
  kind: string;
  target?: string;
  sender?: string;
  text?: string;
  receivedAt: string;
  raw: unknown;
};

export type ChannelProviderCapability = {
  id: ChannelProviderId;
  title: string;
  inbound: "webhook" | "interactions";
  sendText: boolean;
  inboundEvents: boolean;
  notes: string;
};
