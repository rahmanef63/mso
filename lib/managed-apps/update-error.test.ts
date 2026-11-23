import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("./manager", () => ({ assertManagedAppStopped: vi.fn().mockResolvedValue(undefined) }));
const { checkUpdate } = await import("./update");
const updateCli = await import("./update-cli");
beforeEach(() =>
  vi.spyOn(updateCli, "updateAdapter").mockReturnValue({
    ...updateCli.updateAdapter("hermes"),
    probe: async () => { throw "raw probe failure at /home/operator/.hermes/main.py"; },
  }),
);
afterEach(() => vi.restoreAllMocks());
// CodeQL js/stack-trace-exposure #210: a probe rejecting with a non-Error used
// to reach the JSON response body verbatim through String(error).
describe("checkUpdate error boundary", () => {
  it("replaces a thrown non-Error with a fixed message instead of echoing it", async () => {
    expect((await checkUpdate("hermes", true)).error).toBe("unexpected error");
  });
});
