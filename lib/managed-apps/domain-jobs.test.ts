import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("./domain-lifecycle", () => ({ appendDomainProvisioning: vi.fn(async () => undefined) }));
const { appendDomainProvisioning } = await import("./domain-lifecycle");
const { startManagedAppJob, readManagedAppJob } = await import("./jobs");
const { liveRecord, cancelJob } = await import("./job-runner");
let directory: string;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "mso-domain-jobs-"));
  vi.spyOn(os, "homedir").mockReturnValue(directory);
  vi.mocked(appendDomainProvisioning).mockReset().mockResolvedValue();
});
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(directory, { recursive: true, force: true }); });
async function settled(id: string) {
  await vi.waitFor(() => expect(liveRecord(id)).toBeUndefined());
  return readManagedAppJob(id);
}
it("keeps the install job running until domain progress has been recorded", async () => {
  let complete!: () => void;
  vi.mocked(appendDomainProvisioning).mockImplementation(async (_id, append) => {
    await new Promise<void>(resolve => { complete = resolve; });
    append("[mso domain] certificate pending; retry ensure --apply\n");
  });
  const started = await startManagedAppJob({ applicationId: "9router", kind: "install", argv: [process.execPath, "-e", "process.exit(0)"] });
  await vi.waitFor(() => expect(appendDomainProvisioning).toHaveBeenCalledOnce());
  expect((await readManagedAppJob(started.id))?.status).toBe("running");
  expect(cancelJob(started.id, "9router")).toBe(false);
  complete();
  const done = await settled(started.id);
  expect(done).toMatchObject({ status: "succeeded", exitCode: 0 });
  expect(done?.log).toContain("certificate pending");
});
it("does not provision after a failed installer or an uninstall", async () => {
  const failed = await startManagedAppJob({ applicationId: "9router", kind: "install", argv: [process.execPath, "-e", "process.exit(2)"] });
  expect((await settled(failed.id))?.status).toBe("failed");
  const removed = await startManagedAppJob({ applicationId: "9router", kind: "uninstall", argv: [process.execPath, "-e", "process.exit(0)"] });
  expect((await settled(removed.id))?.status).toBe("succeeded");
  expect(appendDomainProvisioning).not.toHaveBeenCalled();
});
