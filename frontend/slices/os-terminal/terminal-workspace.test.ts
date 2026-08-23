import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("terminal workspace policy", () => {
  it("keeps a tabbed workspace while allowing focused single-session tools", () => {
    const app = readFileSync(new URL("./app.tsx", import.meta.url), "utf8");
    const tabs = readFileSync(new URL("./components/terminal-tabs.tsx", import.meta.url), "utf8");
    expect(app).toContain("tabbed = true");
    expect(app).toContain("<TerminalTabs");
    expect(tabs).toContain('role="tablist"');
    expect(tabs).toContain("TerminalSession");
    expect(tabs).toContain("invisible pointer-events-none");
  });

  it("threads an initial cwd into the PTY open request and closes on document teardown", () => {
    const pty = readFileSync(new URL("./lib/use-pty.ts", import.meta.url), "utf8");
    expect(pty).toContain("cwd?: string");
    expect(pty).toContain("cwd: opts.cwd");
    expect(pty).toContain('window.addEventListener("pagehide", onPageHide)');
    expect(pty).toContain('window.addEventListener("pageshow", onPageShow)');
    expect(pty).toContain("event.persisted && disposed");
    expect(pty).toContain("window.location.reload()");
    expect(pty).toContain('post("close", { id }, true)');
  });
});
