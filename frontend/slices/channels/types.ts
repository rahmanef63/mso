export type ChannelProviderId = "telegram" | "discord";
export type ChannelCredential = {
  user: string;
  userLabel: string;
  id: string;
  label: string;
  provider: ChannelProviderId;
  state: string;
  missing: string[];
  verifiedAt?: number | null;
};
export type ChannelView = {
  id: string;
  name: string;
  provider: ChannelProviderId;
  credential: { user: string; connection: string };
  enabled: boolean;
  defaultTarget?: string;
  workflowId?: string;
  createdAt: string;
  updatedAt: string;
  lastCheck?: { at: string; ok: boolean; detail: string };
  lastActivityAt?: string;
  connection?: { state?: string; error?: string; label?: string };
  capabilities: { inbound: "webhook" | "interactions"; notes: string };
};
export type ChannelsSnapshot = {
  version: 1;
  revision: number;
  channels: ChannelView[];
  credentials: ChannelCredential[];
  providers: Array<{ id: ChannelProviderId; title: string; notes: string }>;
};
export type WorkflowOption = {
  id: string;
  name: string;
  status: string;
  nodes: Array<{ type: string; config: Record<string, unknown> }>;
};
