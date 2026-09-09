import { NextRequest } from "next/server";
import { beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  discover: vi.fn(),
  register: vi.fn(),
  remove: vi.fn(),
  resolve: vi.fn(),
  send: vi.fn(),
  stream: vi.fn(),
  get: vi.fn(),
  cancel: vi.fn(),
  handoff: vi.fn(),
  audit: vi.fn(),
  rate: vi.fn(),
  listCreds: vi.fn(),
  getCred: vi.fn(),
  createCred: vi.fn(),
  removeCred: vi.fn(),
  setCred: vi.fn(),
  listInbound: vi.fn(),
  createInbound: vi.fn(),
  removeInbound: vi.fn(),
  tasksOwner: vi.fn(),
  auditTail: vi.fn(),
  resolveBinding: vi.fn(),
  localSessions: vi.fn(),
  localResolve: vi.fn(),
  localHandoff: vi.fn(),
  localSpawn: vi.fn(),
}));
vi.mock("@/lib/auth/require-session", () => ({
  getSessionContext: vi.fn(async () => ({
    role: "owner",
    session: { device_id: "cli-test" },
  })),
}));
vi.mock("@/lib/a2a", () => ({
  listA2AAgents: mocks.list,
  discoverA2AAgent: mocks.discover,
  registerA2AAgent: mocks.register,
  removeA2AAgent: mocks.remove,
  resolveA2AAgent: mocks.resolve,
  sendA2AMessage: mocks.send,
  sendA2AStreamingMessage: mocks.stream,
  getA2ATask: mocks.get,
  cancelA2ATask: mocks.cancel,
  handoffA2A: mocks.handoff,
  listA2AOutboundCredentials: mocks.listCreds,
  getA2AOutboundCredential: mocks.getCred,
  createA2AOutboundCredential: mocks.createCred,
  removeA2AOutboundCredential: mocks.removeCred,
  setA2AAgentCredential: mocks.setCred,
  listA2AInboundTokens: mocks.listInbound,
  createA2AInboundToken: mocks.createInbound,
  removeA2AInboundToken: mocks.removeInbound,
  listA2ATasksOwner: mocks.tasksOwner,
  resolveA2ACredentialBinding: mocks.resolveBinding,
  listA2ALocalSessions: mocks.localSessions,
  resolveA2ALocalSession: mocks.localResolve,
  handoffA2ALocalSession: mocks.localHandoff,
  spawnA2ALocalSubagent: mocks.localSpawn,
}));
vi.mock("@/lib/host/audit-api", () => ({ audit: mocks.audit, readAuditTail: mocks.auditTail }));
vi.mock("@/lib/host/limits-api", () => ({ rateLimited: mocks.rate }));
vi.mock("@/lib/host/request-api", () => ({
  readJson: async (req: Request) => req.json().catch(() => null),
}));
vi.mock("@/lib/mcp/capability-runtime", () => ({
  msoCapabilityRuntime: { list: () => [], invoke: vi.fn(async () => ({ content: [] })) },
}));

export const { GET, POST } = await import("./route");
export const post = (body: object) =>
  new NextRequest("http://localhost/api/v1/a2a", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rate.mockReturnValue(false);
  mocks.resolve.mockResolvedValue({ card: { name: "Peer" } });
  mocks.list.mockResolvedValue([]);
  mocks.listCreds.mockResolvedValue([]);
  mocks.listInbound.mockResolvedValue([]);
  mocks.tasksOwner.mockResolvedValue([]);
  mocks.auditTail.mockResolvedValue([]);
  mocks.resolveBinding.mockReturnValue({});
  mocks.localSessions.mockResolvedValue([]);
  mocks.localResolve.mockResolvedValue({ id: "local-session", title: "bece" });
  mocks.localHandoff.mockResolvedValue({
    session: { id: "local-session", title: "bece" },
    task: { id: "local-task", artifacts: [] },
  });
  mocks.localSpawn.mockResolvedValue({
    session: { id: "child-session", title: "reviewer" },
    task: { id: "child-task", artifacts: [] },
  });
});


export { mocks };
