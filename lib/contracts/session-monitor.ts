export const SESSION_PAGE_SIZE = 6;
export const SESSION_EVENT_PAGE_SIZE = 20;
export type SessionStatus = "ready" | "idle" | "busy" | "ended" | "offline";
export interface SessionCard {
  id: string;
  name: string;
  title: string;
  source: "mcp" | "cli" | "alfa";
  status: SessionStatus;
  receiverConnected: boolean;
  lastSeenAt: string;
  createdAt: string;
  cwd?: string;
  eventCount: number;
  archiveCount: number;
  resumedFrom?: string;
  parentSessionId?: string;
}
export interface SessionLog {
  at: string;
  kind: string;
  tool?: string;
  state?: string;
  detail?: string;
  workflowId?: string;
}
export interface SessionPage {
  sessions: SessionCard[];
  total: number;
  activeCount: number;
  page: number;
  pages: number;
  pageSize: number;
  observedAt: string;
}
export interface SessionDetail {
  session: SessionCard;
  events: SessionLog[];
  total: number;
  page: number;
  pages: number;
  pageSize: number;
  observedAt: string;
}
