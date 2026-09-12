import { afterAll, it, expect } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const root = mkdtempSync(path.join(os.tmpdir(), "mso-presence-capacity-"));
process.env.OS_AGENT_SESSIONS_DIR = path.join(root, "sessions");
process.env.OS_LOCAL_AGENT_PRESENCE_STORE = path.join(root, "presence.json");
const store = await import("./session-store");
const presence = await import("./local-agent-presence");
const owner = "mcp-client:capacity";
const a = await store.createAgentSession(owner, "mcp");
const b = await store.createAgentSession(owner, "mcp");
await presence.touchLocalAgentPresence(owner, a.id, "idle", "initial");
afterAll(() => rmSync(root, { recursive: true, force: true }));
  it("bounds leases after insertion and recovers the historical 1,001-entry store without losing sessions", async () => {
    const file = process.env.OS_LOCAL_AGENT_PRESENCE_STORE!;
    const original = readFileSync(file, "utf8");
    const base = JSON.parse(original).entries[0];
    const entries = Array.from({ length: 1000 }, (_, i) => ({ ...base,
      sessionId: `20260912_120000_${i.toString(16).padStart(8, "0")}`,
      lastSeenAt: new Date(Date.now() - 2000 + i).toISOString() }));
    try {
      writeFileSync(file, JSON.stringify({ version: 1, entries }), { mode: 0o600 });
      await presence.touchLocalAgentPresence(owner, a.id, "idle", "bounded");
      expect(JSON.parse(readFileSync(file, "utf8")).entries).toHaveLength(1000);
      expect(await presence.listLocalAgentPresenceOwner()).toHaveLength(1000);
      entries.push({ ...base, sessionId: a.id, lastSeenAt: new Date().toISOString() });
      writeFileSync(file, JSON.stringify({ version: 1, entries }), { mode: 0o600 });
      expect(await presence.listLocalAgentPresenceOwner()).toHaveLength(1000);
      await presence.touchLocalAgentPresence(owner, b.id, "idle", "repair");
      expect(JSON.parse(readFileSync(file, "utf8")).entries).toHaveLength(1000);
      expect(await store.getAgentSession(owner, a.id)).not.toBeNull();
      expect(await store.getAgentSession(owner, b.id)).not.toBeNull();
      entries[0].principalHash = "invalid";
      writeFileSync(file, JSON.stringify({ version: 1, entries }), { mode: 0o600 });
      await expect(presence.listLocalAgentPresenceOwner()).rejects.toThrow("invalid schema");
    } finally { writeFileSync(file, original, { mode: 0o600 }); }
  });

