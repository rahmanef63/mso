import { describe, expect, it } from "vitest";
import { readSetupJson } from "./setup-http";

const request = (notes: string) => new Request("http://localhost/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ notes }) });
describe("bounded JSON request reader", () => {
  it("retains the strict integration setup default while permitting larger organization notes", async () => {
    const notes = "Source line\n".repeat(2000);
    await expect(readSetupJson(request(notes))).rejects.toThrow("request_too_large");
    await expect(readSetupJson(request(notes), 2 * 1024 * 1024)).resolves.toEqual({ notes });
  });
  it("rejects invalid overrides and still enforces the chosen stream limit", async () => {
    for (const max of [0, -1, NaN, Infinity, 2.5, 2 * 1024 * 1024 + 1]) await expect(readSetupJson(request("x"), max)).rejects.toThrow("invalid_body_limit");
    await expect(readSetupJson(request("x".repeat(50)), 40)).rejects.toThrow("request_too_large");
  });
});
