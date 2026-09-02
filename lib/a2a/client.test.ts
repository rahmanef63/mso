import { describe, expect, it } from "vitest";
import { cancelA2ATask, discoverA2AAgent, getA2ATask, sendA2AMessage } from "./client";

const card = (binding = "JSONRPC") => ({
  name: "Research Agent", description: "Finds concise answers", version: "1.2.0", capabilities: { streaming: false },
  supportedInterfaces: [{ url: "https://agent.example.test/a2a", protocolBinding: binding, protocolVersion: "1.0", tenant: "research" }],
  defaultInputModes: ["text/plain"], defaultOutputModes: ["text/plain"], skills: [{ id: "research", name: "Research", description: "Research topics", tags: ["web"] }],
});
function response(value: unknown) { return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } }); }

it("discovers the standard well-known v1 Agent Card and selects JSONRPC", async () => {
  let seen = "";
  const agent = await discoverA2AAgent("https://agent.example.test/a2a", async (input) => { seen = String(input); return response(card()); });
  expect(seen).toBe("https://agent.example.test/.well-known/agent-card.json");
  expect(agent.card.name).toBe("Research Agent"); expect(agent.selectedInterface.protocolBinding).toBe("JSONRPC");
});

it("sends v1 JSONRPC SendMessage with tenant and member-discriminated text parts", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => { calls.push({ url: String(input), init }); return calls.length === 1 ? response(card()) : response({ jsonrpc: "2.0", id: "x", result: { task: { id: "t-1" } } }); };
  const agent = await discoverA2AAgent("https://agent.example.test", fetcher);
  const result = await sendA2AMessage(agent, "Do the research", { returnImmediately: true }, fetcher) as { task: { id: string } };
  const body = JSON.parse(String(calls[1].init?.body));
  expect(body.method).toBe("SendMessage"); expect(body.params.tenant).toBe("research");
  expect(body.params.message.role).toBe("ROLE_USER"); expect(body.params.message.parts).toEqual([{ text: "Do the research", mediaType: "text/plain" }]);
  expect(body.params.message.parts[0]).not.toHaveProperty("kind"); expect(result.task.id).toBe("t-1");
});

it("uses v1 HTTP+JSON operation paths for send/get/cancel including tenant", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => { calls.push({ url: String(input), init }); return calls.length === 1 ? response(card("HTTP+JSON")) : response({ task: { id: "t-1" } }); };
  const agent = await discoverA2AAgent("https://agent.example.test", fetcher);
  await sendA2AMessage(agent, "go", {}, fetcher); await getA2ATask(agent, "t-1", 4, fetcher); await cancelA2ATask(agent, "t-1", fetcher);
  expect(calls[1].url).toBe("https://agent.example.test/a2a/research/message:send");
  expect(calls[2].url).toBe("https://agent.example.test/a2a/research/tasks/t-1?historyLength=4");
  expect(calls[3].url).toBe("https://agent.example.test/a2a/research/tasks/t-1:cancel");
});

it("fails closed when the Agent Card requires authentication", async () => {
  const secured = { ...card(), securityRequirements: [{ oauth: { scopes: ["agent"] } }], securitySchemes: { oauth: { oauth2SecurityScheme: {} } } };
  const fetcher = async () => response(secured); const agent = await discoverA2AAgent("https://agent.example.test", fetcher);
  await expect(sendA2AMessage(agent, "secret work", {}, fetcher)).rejects.toThrow("credential profiles are not configured");
});
