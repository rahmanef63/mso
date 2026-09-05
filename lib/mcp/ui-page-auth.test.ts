import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { MSO_PAGE_AUTH_SCRIPT } from "./ui-page-auth";

function fixture(path = "/?auth=google") {
  const events = new Map<string, (event: unknown) => void>();
  const buttons: Array<{ click: () => Promise<void>; focus: ReturnType<typeof vi.fn>; disabled: boolean }> = [];
  const rpcRequest = vi.fn(async () => ({}));
  const frame = { contentWindow: {} };
  const message = { textContent: "" };
  const context = {
    URL, hostConnected: true, rpcRequest,
    window: { addEventListener: (name: string, fn: (event: unknown) => void) => events.set(name, fn), removeEventListener: (name: string) => events.delete(name) },
    button: (_label: string, click: () => Promise<void>) => { const b = { click, focus: vi.fn(), disabled: false }; buttons.push(b); return b; },
  };
  const cleanup = runInNewContext(`${MSO_PAGE_AUTH_SCRIPT}; mountReviewedAuth`, context)(
    { origin: "https://game.rahmanef.com", externalAuthPath: path }, frame, { append: vi.fn() }, message,
  );
  return { events, buttons, rpcRequest, frame, message, cleanup };
}

describe("reviewed external auth action", () => {
  it("opens only the code-owned same-origin path after a host button click", async () => {
    const f = fixture();
    f.events.get("message")?.({ source: f.frame.contentWindow, origin: "https://game.rahmanef.com", data: { type: "mso:app-auth-request", schemaVersion: 1, provider: "google", url: "https://attacker.test" } });
    expect(f.buttons[0].focus).toHaveBeenCalledOnce();
    expect(f.rpcRequest).not.toHaveBeenCalled();
    await f.buttons[0].click();
    expect(f.rpcRequest).toHaveBeenCalledExactlyOnceWith("ui/open-link", { url: "https://game.rahmanef.com/?auth=google" });
    expect(f.message.textContent).toContain("Preview sessions are separate");
  });
  it("ignores spoofed message sources, origins, providers and schema versions", () => {
    const f = fixture();
    const base = { source: f.frame.contentWindow, origin: "https://game.rahmanef.com", data: { type: "mso:app-auth-request", schemaVersion: 1, provider: "google" } };
    for (const event of [{ ...base, source: {} }, { ...base, origin: "https://attacker.test" }, { ...base, data: { ...base.data, schemaVersion: 99 } }, { ...base, data: { ...base.data, provider: "unknown" } }]) f.events.get("message")?.(event);
    expect(f.buttons[0].focus).not.toHaveBeenCalled();
    expect(f.rpcRequest).not.toHaveBeenCalled();
    f.cleanup(); expect(f.events.has("message")).toBe(false);
  });
  it.each(["https://attacker.test", "//attacker.test", "/\\attacker.test"])("rejects an off-origin registry path %s", (path) => {
    expect(fixture(path).buttons).toHaveLength(0);
  });
  it("offers a recovery action when the chat host rejects navigation", async () => {
    const f = fixture(); f.rpcRequest.mockRejectedValueOnce(new Error("blocked"));
    await f.buttons[0].click();
    expect(f.message.textContent).toContain("Use Open production");
    expect(f.buttons[0].disabled).toBe(false);
  });
});
