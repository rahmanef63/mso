import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("./domain-lifecycle", () => ({ provisionDomainAfterStart: vi.fn(), readManagedDomainView: vi.fn() }));
vi.mock("./runner", () => ({ commandExists: vi.fn(async () => false), resolveCommand: vi.fn(async () => null), runProgram: vi.fn(async () => ({ code: 0, stdout: "LoadState=not-found", stderr: "" })) }));
vi.mock("./docker", () => ({ dockerUsable: vi.fn(async () => true), requireDocker: vi.fn(), runDocker: vi.fn(async args => ({ code: 0, stdout: args[0] === "ps" ? "9router" : "true", stderr: "" })) }));
vi.mock("./lock", () => ({ acquireOperation: vi.fn(() => true), activeOperation: vi.fn(() => null), releaseOperation: vi.fn(), withManagedAppOperationLease: async (_id: string, run: () => Promise<void>) => run() }));
vi.mock("./job-store", () => ({ listJobRecords: vi.fn(async () => []) }));
vi.mock("./backups", () => ({ createBackup: vi.fn() }));
const { provisionDomainAfterStart, readManagedDomainView } = await import("./domain-lifecycle");
const { requireDocker } = await import("./docker");
const { performManagedAppAction } = await import("./manager");
beforeEach(() => {
  vi.mocked(requireDocker).mockReset().mockResolvedValue();
  vi.mocked(provisionDomainAfterStart).mockReset().mockResolvedValue({ domain: null, domainDiagnostic: null });
  vi.mocked(readManagedDomainView).mockReset().mockResolvedValue({ domain: null, domainDiagnostic: null });
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(null, { status: 200 }));
});
afterEach(() => vi.restoreAllMocks());
it.each(["start", "restart"] as const)("provisions after successful %s without misreporting a DNS error as an app failure", async action => {
  vi.mocked(provisionDomainAfterStart).mockResolvedValue({ domain: null, domainDiagnostic: "Cloudflare needs authorization" });
  const view = await performManagedAppAction("9router", action);
  expect(requireDocker).toHaveBeenCalledWith([action, "9router"], 30_000);
  expect(provisionDomainAfterStart).toHaveBeenCalledWith("9router");
  expect(view).toMatchObject({ state: "running", domainDiagnostic: "Cloudflare needs authorization" });
});
it("does not provision when the local start fails", async () => {
  vi.mocked(requireDocker).mockRejectedValue(new Error("Docker denied the start"));
  await expect(performManagedAppAction("9router", "start")).rejects.toThrow("Docker denied");
  expect(provisionDomainAfterStart).not.toHaveBeenCalled();
});
it("advertises a verified domain through the managed app view", async () => {
  vi.mocked(readManagedDomainView).mockResolvedValue({ domain: { appId: "9router", hostname: "9router.mso.example.com", phase: "ready", updatedAt: 1, verifiedAt: 1 }, domainDiagnostic: null });
  expect((await performManagedAppAction("9router", "start")).publicDashboardUrl).toBe("https://9router.mso.example.com");
});
