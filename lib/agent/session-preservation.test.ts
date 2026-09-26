import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { preservationDecision, sessionPreservation, updateSessionPreservation } from "./session-preservation";
const roots: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
describe("source preservation policy", () => {
  it("never treats age or a learned/reviewed claim as permission to delete", () => {
    expect(preservationDecision(null)).toMatchObject({ protected: true, reason: "unreviewed" });
    expect(preservationDecision({ version: 1, sessionId: "20260925_010101_deadbeef", pinned: false, state: "reviewed", updatedAt: new Date().toISOString() })).toMatchObject({ protected: true, reason: "source-release-not-approved" });
  });
  it("persists pinning with optimistic revision checks", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mso-preservation-")); roots.push(root); vi.stubEnv("OS_AGENT_SESSIONS_DIR", root);
    const id = "20260925_010101_deadbeef", before = await sessionPreservation(id);
    expect(before.reason).toBe("unreviewed");
    await updateSessionPreservation(id, before.revision, { pinned: true });
    expect(await sessionPreservation(id)).toMatchObject({ protected: true, reason: "pinned" });
    await expect(updateSessionPreservation(id, before.revision, { pinned: false })).rejects.toThrow("refresh");
  });
  it("fails closed for malformed identities", async () => { expect(await sessionPreservation("../escape")).toMatchObject({ protected: true, reason: "preservation-unavailable" }); });
});
