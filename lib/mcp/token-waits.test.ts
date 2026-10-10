import { describe, expect, it } from "vitest";
import { abortMcpTokenWaits, registerMcpTokenWait } from "./token-waits";
describe("MCP wait cancellation", () => {
  it("isolates tokens, cleans released waits, and propagates disconnects", () => {
    const parent = new AbortController(), a = registerMcpTokenWait("a",parent.signal), b = registerMcpTokenWait("b");
    parent.abort(); expect(a.signal.aborted).toBe(true); expect(b.signal.aborted).toBe(false); a.release();
    abortMcpTokenWaits("b"); expect(b.signal.aborted).toBe(true);
    const next = registerMcpTokenWait("b"); b.release();
    abortMcpTokenWaits("b"); expect(next.signal.aborted).toBe(true); next.release();
    const released = registerMcpTokenWait("c"); released.release(); abortMcpTokenWaits("c"); expect(released.signal.aborted).toBe(false);
  });
});
