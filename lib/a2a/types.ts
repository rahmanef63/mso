export type A2AStandardBinding = "JSONRPC" | "HTTP+JSON";

export type A2AAgentInterface = {
  url: string;
  protocolBinding: string;
  protocolVersion: string;
  tenant?: string;
};

export type A2AAgentSkill = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  inputModes: string[];
  outputModes: string[];
};

export type A2AAgentCard = {
  name: string;
  description: string;
  version: string;
  supportedInterfaces: A2AAgentInterface[];
  capabilities: Record<string, boolean>;
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: A2AAgentSkill[];
  securityRequirements: Array<Record<string, unknown>>;
  securitySchemeNames: string[];
  requiresAuthentication: boolean;
};

export type A2ADiscoveredAgent = {
  cardUrl: string;
  card: A2AAgentCard;
  selectedInterface: A2AAgentInterface;
};

export type A2ARegisteredAgent = {
  id: string;
  alias: string;
  cardUrl: string;
  card: A2AAgentCard;
  registeredAt: string;
  updatedAt: string;
};

export type A2ASendOptions = {
  contextId?: string;
  taskId?: string;
  returnImmediately?: boolean;
  historyLength?: number;
  metadata?: Record<string, unknown>;
};
