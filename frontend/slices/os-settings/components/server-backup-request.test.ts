import { afterEach, describe, expect, it, vi } from "vitest";
import { requestBackup } from "./server-backup-request";
afterEach(() => vi.unstubAllGlobals());
describe("server backup request", () => {
  it("encodes pagination and disables caching", async () => {
    const fetcher = vi.fn(async () => Response.json({ items: [] })); vi.stubGlobal("fetch", fetcher);
    await expect(requestBackup(undefined, { view: "history", offset: "12", revision: "a&b" })).resolves.toEqual({ items: [] });
    expect(fetcher).toHaveBeenCalledWith("/api/v1/sys/memory-backup?view=history&offset=12&revision=a%26b", { cache: "no-store" });
  });
  it("surfaces errors rather than returning an empty history", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "history_changed" }, { status: 409 })));
    await expect(requestBackup()).rejects.toThrow("history_changed");
  });
  it("keeps explicit confirmation in the existing POST transport", async () => {
    const fetcher = vi.fn(async () => Response.json({ id: "test" })); vi.stubGlobal("fetch", fetcher);
    await requestBackup({ action: "verify", confirm: true });
    expect(fetcher).toHaveBeenCalledWith("/api/v1/sys/memory-backup", expect.objectContaining({ method: "POST", body: '{"action":"verify","confirm":true}' }));
  });
});
