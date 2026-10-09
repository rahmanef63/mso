import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/host/projects-api", () => ({ resolveProjectHint: vi.fn(async (id: string) => id === "local" ? { path: "/reviewed", matchedBy: "exact" } : null) }));
import { consumeFederationApproval, federationRequestDigest } from "./local-approval";
import { FEDERATION_WORKER_ID } from "./security";
const request = { id: "request-1", projectId: "local", source: "mso", operation: "exec_run", scope: "exec", arguments: { command: "true" } };
let home: string, file: string;
beforeEach(async () => { home = await fs.mkdtemp(path.join(os.tmpdir(), "mso-fed-approval-")); vi.spyOn(os, "homedir").mockReturnValue(home); file = path.join(home, ".mso/private/federation-approvals.json"); });
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(home, { recursive: true, force: true }); });
async function grant(expiresAt = Date.now() + 60000) { await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 }); await fs.writeFile(file, JSON.stringify({ [request.id]: { principal: FEDERATION_WORKER_ID, requestDigest: federationRequestDigest(request), expiresAt } }), { mode: 0o600 }); }
it("denies a scope-labelled confirmed remote request without local approval", async () => { await expect(consumeFederationApproval(request)).rejects.toThrow(/Owner approval/); });
it("consumes one exact reviewed request and rejects replay", async () => { await grant(); expect(await consumeFederationApproval(request)).toBe("/reviewed"); await expect(consumeFederationApproval(request)).rejects.toThrow(/already used/); });
it.each(["operation", "scope", "arguments", "source"])("rejects a changed %s without consuming the grant", async field => { await grant(); await expect(consumeFederationApproval({ ...request, [field]: field === "arguments" ? { command: "other" } : "other" })).rejects.toThrow(/changed/); expect(await consumeFederationApproval(request)).toBe("/reviewed"); });
it("rejects expiry, revocation and unknown projects", async () => { await grant(Date.now() - 1); await expect(consumeFederationApproval(request)).rejects.toThrow(/expired/); await grant(); await expect(consumeFederationApproval({ ...request, projectId: "remote-path" })).rejects.toThrow(/exact local project/); await fs.unlink(file); await expect(consumeFederationApproval(request)).rejects.toThrow(/Owner approval/); });
