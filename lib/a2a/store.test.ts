import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";

const dirs: string[] = [];
afterEach(async () => {
  vi.resetModules();
  delete process.env.OS_A2A_STORE;
  await Promise.all(
    dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

it("stores registered public Agent Cards in a private atomic registry", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mso-a2a-"));
  dirs.push(dir);
  process.env.OS_A2A_STORE = path.join(dir, "private", "agents.json");
  const client = await import("./client");
  vi.spyOn(client, "discoverA2AAgent").mockResolvedValue({
    cardUrl: "https://agent.example/.well-known/agent-card.json",
    selectedInterface: {
      url: "https://agent.example/a2a",
      protocolBinding: "JSONRPC",
      protocolVersion: "1.0",
    },
    card: {
      name: "Research Agent",
      description: "Research",
      version: "1",
      supportedInterfaces: [
        {
          url: "https://agent.example/a2a",
          protocolBinding: "JSONRPC",
          protocolVersion: "1.0",
        },
      ],
      capabilities: {},
      defaultInputModes: ["text/plain"],
      defaultOutputModes: ["text/plain"],
      skills: [],
      securityRequirements: [],
      securitySchemeNames: [],
      requiresAuthentication: false,
    },
  });
  const store = await import("./store");
  const registered = await store.registerA2AAgent(
    "https://agent.example",
    "research",
  );
  expect(registered.alias).toBe("research");
  expect(await store.listA2AAgents()).toHaveLength(1);
  const stat = await fs.stat(process.env.OS_A2A_STORE);
  expect(stat.mode & 0o777).toBe(0o600);
  expect(
    (await fs.stat(path.dirname(process.env.OS_A2A_STORE))).mode & 0o777,
  ).toBe(0o700);
  expect(await store.removeA2AAgent("research")).toBe(true);
  expect(await store.listA2AAgents()).toHaveLength(0);
});
